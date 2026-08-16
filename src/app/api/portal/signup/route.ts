import { NextRequest } from 'next/server'
import { db } from '@/db'
import {
  facilities,
  portalAccounts,
  portalAccountResidents,
  portalClaimRequests,
  residents,
} from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { createMagicLink } from '@/lib/portal-auth'
import { issueWelcomeCoupon } from '@/lib/portal-coupons'
import { sendEmail, buildPortalMagicLinkEmailHtml, buildClaimPendingEmailHtml } from '@/lib/email'
import { matchResidentForSignup, strictNameScore, nameAgreement } from '@/lib/signup-match'
import { activeFacilityByCodeWhere } from '@/lib/facility-code'
import { ensurePortalClaimsSchema } from '@/lib/portal-claims-ddl'

export const dynamic = 'force-dynamic'

const signupSchema = z.object({
  email: z.string().email().max(320),
  fullName: z.string().min(2).max(200),
  facilityCode: z.string().min(1).max(50),
  // P54 — phone is MANDATORY (owner decision, Fitzgerald meeting)
  phone: z.string().min(7).max(30),
  // Accepted for back-compat; the P50 wizard no longer sends it (unused PII).
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  // P50 — the wizard asks WHO the resident is, which turns admin review from
  // guesswork into a one-click confirm.
  residentName: z.string().min(2).max(200).optional().nullable(),
  roomNumber: z.string().max(50).optional().nullable(),
  relationship: z.enum(['self', 'spouse', 'child', 'poa', 'other']).optional().nullable(),
  // P52 — the family tapped "Yes — that's them" on the match confirm card.
  // Client-asserted: the server re-derives the match + POA-name agreement
  // before it grants anything (tier 1.5 below).
  familyConfirmed: z.boolean().optional(),
  // P53 — master-only DRY RUN (Debug tab): the full pipeline runs — facility
  // lookup, 409 check, matching, tier decisions — but EVERY side effect is
  // skipped (no accounts/claims/residents/coupons/emails/bells). Verified
  // against the caller's Supabase session server-side; 403 for anyone else.
  preview: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = await checkRateLimit('portalSignup', ip)
  if (!rl.ok) return rateLimitResponse(rl.retryAfter)

  const body = await request.json().catch(() => null)
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  const parsed = signupSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 })

  const { email, fullName, facilityCode, phone, dateOfBirth, residentName, roomNumber, relationship, familyConfirmed } = parsed.data
  const normalizedEmail = email.toLowerCase().trim()

  // P53 — DRY RUN: verify the caller's Supabase session is the MASTER before
  // anything else (client-asserted flag, server-verified — the familyConfirmed
  // doctrine). Guards below thread through the SINGLE real pipeline so preview
  // logic can never diverge from production.
  const preview = parsed.data.preview === true
  if (preview) {
    const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    let masterOk = false
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      masterOk = !!su && user?.email === su
    } catch {
      masterOk = false
    }
    if (!masterOk) {
      return Response.json({ error: 'Preview is only available to the master admin.' }, { status: 403 })
    }
  }

  await ensurePortalClaimsSchema()

  // P53 — case-insensitive + demo-facility-excluded lookup (shared helper).
  const facility = await db.query.facilities.findFirst({
    where: activeFacilityByCodeWhere(facilityCode),
    columns: {
      id: true, name: true, facilityCode: true, contactEmail: true,
      portalSelfSignupEnabled: true,
      portalCouponsEnabled: true,
      portalWelcomeCouponEnabled: true,
    },
  })
  if (!facility) return Response.json({ error: 'Facility not found' }, { status: 404 })
  // Preview skips the flag 403 so a flag-off facility is still dry-runnable.
  if (!facility.portalSelfSignupEnabled && !preview) {
    return Response.json({ error: 'Self-signup is not available for this facility.' }, { status: 403 })
  }

  // Check if already linked to an ACTIVE resident at this facility.
  // P53 — the active join matters: a discharged resident's stale link used to
  // 409 here ("sign in instead") while login bounced with no_access — an
  // unbreakable loop for re-admitted residents. Dead links don't count.
  const activeLinks = await db
    .select({ id: portalAccountResidents.id })
    .from(portalAccountResidents)
    .innerJoin(portalAccounts, eq(portalAccounts.id, portalAccountResidents.portalAccountId))
    .innerJoin(residents, eq(residents.id, portalAccountResidents.residentId))
    .where(
      and(
        eq(portalAccounts.email, normalizedEmail),
        eq(portalAccountResidents.facilityId, facility.id),
        eq(residents.active, true),
      ),
    )
    .limit(1)
  if (activeLinks.length > 0) {
    return Response.json({
      error: 'You already have portal access for this facility. Sign in instead.',
    }, { status: 409 })
  }

  // 1. Try email match: resident.poaEmail = this email at this facility
  const emailMatches = await db.query.residents.findMany({
    where: and(
      eq(residents.facilityId, facility.id),
      eq(residents.poaEmail, normalizedEmail),
      eq(residents.active, true),
      eq(residents.isDemo, false),
    ),
    columns: { id: true, name: true, roomNumber: true },
  })

  if (emailMatches.length > 0) {
    if (preview) return Response.json({ status: 'auto_approved', preview: true }) // dry run: no writes
    const portalAccountId = await autoApprove({
      email: normalizedEmail,
      fullName,
      phone: phone ?? null,
      dateOfBirth: dateOfBirth ?? null,
      facilityId: facility.id,
      facilityCode: facility.facilityCode ?? facilityCode,
      facilityName: facility.name,
      matchedResidents: emailMatches,
      matchType: 'email',
      matchConfidence: 'high',
    })
    await issueWelcomeCoupon(facility.id, portalAccountId, emailMatches[0]?.id ?? null).catch(() => {})
    return Response.json({ status: 'auto_approved' })
  }

  // 2. Match against the facility roster. P50 tier order:
  //    (a) the wizard-supplied RESIDENT name vs residents.name (+ room as a
  //        confidence booster) — the strongest non-email signal;
  //    (b) the applicant's own name vs residents.poaName (legacy fallback).
  const facilityResidents = await db.query.residents.findMany({
    where: and(
      eq(residents.facilityId, facility.id),
      eq(residents.active, true),
      eq(residents.isDemo, false),
    ),
    columns: { id: true, name: true, poaName: true, roomNumber: true },
  })

  const claimedResidentName = residentName?.trim() ?? ''

  // P52 — the shared matcher (src/lib/signup-match.ts) is the SINGLE source of
  // truth; the preview endpoint calls the same function, so what the family
  // confirmed is exactly what we re-derive here.
  const m = matchResidentForSignup(facilityResidents, claimedResidentName, roomNumber)

  // Tier 1.5 — instant link: the family confirmed the match card AND their own
  // typed name agrees with the resident's on-file POA/family-contact name.
  // Room numbers are door-visible; the POA name is not — reproducing it plus
  // the confirmation is treated like knowing the family relationship.
  // P53: nameAgreement (both names ≥2 words, first+last agree) — the old
  // fuzzyScore>=0.8 was defeated by its substring rule (a lone surname
  // contained in the POA name scored 0.85 and instant-approved a stranger).
  if (familyConfirmed && m?.confident && m.resident.poaName && nameAgreement(fullName, m.resident.poaName)) {
    if (preview) return Response.json({ status: 'auto_approved', preview: true }) // dry run: no writes
    const portalAccountId = await autoApprove({
      email: normalizedEmail,
      fullName,
      phone: phone ?? null,
      dateOfBirth: dateOfBirth ?? null,
      facilityId: facility.id,
      facilityCode: facility.facilityCode ?? facilityCode,
      facilityName: facility.name,
      matchedResidents: [{ id: m.resident.id, name: m.resident.name, roomNumber: m.resident.roomNumber }],
      matchType: 'resident_confirmed',
      matchConfidence: 'high',
      familyConfirmed: true,
    })
    await issueWelcomeCoupon(facility.id, portalAccountId, m.resident.id).catch(() => {})
    return Response.json({ status: 'auto_approved' })
  }

  // Legacy fallback when the resident name matched nothing: the applicant's
  // own name vs residents.poaName. P53: strictNameScore (no substring
  // inflation of the admin confidence chip).
  let bestMatch: { resident: (typeof facilityResidents)[0]; score: number; type: 'resident_room' | 'name' } | null =
    m ? { resident: m.resident, score: m.score, type: 'resident_room' } : null
  if (!bestMatch) {
    for (const r of facilityResidents) {
      if (!r.poaName) continue
      const score = strictNameScore(fullName, r.poaName)
      if (score > (bestMatch?.score ?? 0.59)) {
        bestMatch = { resident: r, score, type: 'name' }
      }
    }
  }

  // Name-based matches NEVER auto-approve — only an exact POA-email match or
  // tier 1.5 (family-confirmed + POA-name agreement, above) does. Room numbers
  // are visible on doors, so even resident-name+room is NOT proof of a real
  // family connection; it just makes the admin's review a one-click confirm
  // instead of a full-roster hunt. A stranger who knows a name must always
  // pass a human.
  const roomAgrees = m?.roomAgrees ?? false
  // P53 — an AMBIGUOUS match (exact top-score tie between different residents)
  // never stamps a residentId: the admin card's one-click Approve would link
  // whichever row the DB returned first. The admin picks from the full roster.
  const ambiguous = m?.ambiguous ?? false
  // Family-confirmed confident matches surface as 'high' with the resident
  // pre-picked so the admin card is a true one-tap confirm.
  const confidence = familyConfirmed && m?.confident
    ? 'high'
    : ambiguous
      ? 'low'
      : bestMatch
        ? bestMatch.type === 'resident_room'
          ? (bestMatch.score >= 0.85 && roomAgrees) ? 'high' : bestMatch.score >= 0.75 ? 'medium' : 'low'
          : bestMatch.score >= 0.80 ? 'high' : bestMatch.score >= 0.65 ? 'medium' : 'low'
        : null

  const claimValues = {
    facilityId: facility.id,
    facilityCode: facility.facilityCode ?? facilityCode,
    email: normalizedEmail,
    fullName,
    phone: phone ?? null,
    dateOfBirth: dateOfBirth ?? null,
    residentName: claimedResidentName || null,
    roomNumber: roomNumber?.trim() || null,
    relationship: relationship ?? null,
    residentId: ambiguous ? null : bestMatch?.resident.id ?? null,
    matchType: ambiguous ? null : bestMatch?.type ?? null,
    matchConfidence: confidence,
    // P53 — record the family's confirmation only when the server's own match
    // was confident; the badge must never over-claim.
    familyConfirmed: familyConfirmed && m?.confident ? true : null,
    status: 'pending_review' as const,
  }

  // P53 — DRY RUN exit: the full match + confidence derivation ran above;
  // stop before ANY write (claim insert/dedup-update, admin email + bell,
  // applicant email).
  if (preview) return Response.json({ status: 'pending', preview: true })

  // P53 — dedup: an anxious double-submit used to create TWO pending cards
  // (and two "Create as new resident" buttons → duplicate residents). Update
  // the existing pending claim in place and skip the duplicate notifications.
  const existingClaim = await db.query.portalClaimRequests.findFirst({
    where: and(
      eq(portalClaimRequests.email, normalizedEmail),
      eq(portalClaimRequests.facilityId, facility.id),
      eq(portalClaimRequests.status, 'pending_review'),
    ),
    columns: { id: true },
  })
  if (existingClaim) {
    await db.update(portalClaimRequests).set(claimValues).where(eq(portalClaimRequests.id, existingClaim.id))
    return Response.json({ status: 'pending' })
  }

  await db.insert(portalClaimRequests).values(claimValues)

  // Notify facility admin (fire-and-forget)
  const adminEmail = facility.contactEmail ?? process.env.NEXT_PUBLIC_ADMIN_EMAIL
  if (adminEmail) {
    const settingsUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/settings?section=portal`
    sendEmail({
      to: adminEmail,
      subject: `New Family Portal account request — ${facility.name}`,
      html: buildClaimRequestEmailHtml({ fullName, email: normalizedEmail, facilityName: facility.name, settingsUrl }),
    }).catch(() => {})
  }

  // P50 — in-app bell for every facility admin (email alone rots unwatched).
  import('@/lib/notify').then(({ notifyFacilityAdmins }) =>
    notifyFacilityAdmins(facility.id, {
      type: 'portal_claim',
      title: 'New Family Portal request',
      body: `${fullName} asked for portal access${claimedResidentName ? ` for ${claimedResidentName}` : ''} — review it in Settings.`,
      url: '/settings?section=portal',
    }),
  ).catch(() => {})

  // P50 — the applicant gets a real confirmation instead of silence.
  sendEmail({
    to: normalizedEmail,
    subject: `We received your request — ${facility.name} Family Portal`,
    html: buildClaimPendingEmailHtml({ fullName, facilityName: facility.name }),
  }).catch(() => {})

  return Response.json({ status: 'pending' })
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function autoApprove(opts: {
  email: string
  fullName: string
  phone: string | null
  dateOfBirth: string | null
  facilityId: string
  facilityCode: string
  facilityName: string
  matchedResidents: Array<{ id: string; name: string; roomNumber: string | null }>
  matchType: string
  matchConfidence: string
  familyConfirmed?: boolean
}): Promise<string> {
  const { email, fullName, phone, dateOfBirth, facilityId, facilityCode, facilityName, matchedResidents, matchType, matchConfidence, familyConfirmed } = opts

  // Upsert portal account
  const existing = await db.query.portalAccounts.findFirst({
    where: eq(portalAccounts.email, email),
    columns: { id: true },
  })

  let portalAccountId: string
  if (existing) {
    // Update profile info if provided
    await db
      .update(portalAccounts)
      .set({
        fullName: fullName || undefined,
        phone: phone ?? undefined,
        ...(dateOfBirth ? { dateOfBirth } : {}),
      })
      .where(eq(portalAccounts.id, existing.id))
    portalAccountId = existing.id
  } else {
    const [created] = await db
      .insert(portalAccounts)
      .values({
        email,
        fullName,
        phone,
        dateOfBirth: dateOfBirth ?? null,
      })
      .returning({ id: portalAccounts.id })
    portalAccountId = created.id
  }

  // Link residents
  for (const r of matchedResidents) {
    await db
      .insert(portalAccountResidents)
      .values({ portalAccountId, residentId: r.id, facilityId })
      .onConflictDoNothing()
  }

  // Audit record
  await db.insert(portalClaimRequests).values({
    facilityId,
    facilityCode,
    email,
    fullName,
    phone,
    dateOfBirth: dateOfBirth ?? null,
    residentId: matchedResidents[0]?.id ?? null,
    matchType,
    matchConfidence,
    familyConfirmed: familyConfirmed ?? null,
    status: 'auto_approved',
  }).catch(() => {})

  // Send magic link email — AWAITED (user-initiated "send" path)
  const magicLink = await createMagicLink(email, matchedResidents[0]?.id ?? null, facilityCode)
  const residentNames = matchedResidents.map((r) => r.name)
  await sendEmail({
    to: email,
    subject: `Welcome to the ${facilityName} Family Portal`,
    html: buildPortalMagicLinkEmailHtml({ residentNames, facilityName, link: magicLink, expiresInHours: 72 }),
  })

  return portalAccountId
}

function buildClaimRequestEmailHtml(params: {
  fullName: string
  email: string
  facilityName: string
  settingsUrl: string
}): string {
  const { fullName, email, facilityName, settingsUrl } = params
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;">New Family Portal Request</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">${facilityName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 16px;color:#1C1917;font-size:15px;line-height:1.6;">
        <strong>${fullName}</strong> (${email}) has requested Family Portal access and couldn't be automatically matched to a resident.
      </p>
      <p style="margin:0 0 24px;color:#57534E;font-size:14px;line-height:1.5;">
        Review and approve or reject this request in Settings → Family Portal.
      </p>
      <p style="margin:0;">
        <a href="${settingsUrl}" style="display:inline-block;background:#8B2E4A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;">Review Request</a>
      </p>
    </div>
  </div>
</body>
</html>`.trim()
}
