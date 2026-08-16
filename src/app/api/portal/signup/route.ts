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
import { createMagicLink, createPortalSession, setPortalSessionCookie } from '@/lib/portal-auth'
import { issueWelcomeCoupon } from '@/lib/portal-coupons'
import { mintSignupCardToken } from '@/lib/signup-card-token'
import { platformPublishableKey, paymentsBlocked } from '@/lib/payments/stripe-client'
import { randomBytes } from 'node:crypto'
import { sendEmail, buildPortalMagicLinkEmailHtml } from '@/lib/email'
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

  // P54 — the wizard shows a card page after the review step whenever the
  // platform Stripe keys are configured AND live charging isn't blocked.
  const paymentsEnabled = !!platformPublishableKey() && !paymentsBlocked()

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
    if (preview) return Response.json({ status: 'auto_approved', preview: true, paymentsEnabled }) // dry run: no writes
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
    // P54 — payment step: matched signups get a 30-min single-use card token
    // (never a session — the magic link stays the email verification).
    const primaryResident = emailMatches[0] ?? null
    const cardToken = paymentsEnabled && primaryResident
      ? await mintSignupCardToken({ residentId: primaryResident.id, facilityId: facility.id, portalAccountId }).catch(() => null)
      : null
    return Response.json({
      status: 'auto_approved',
      paymentsEnabled: paymentsEnabled && !!cardToken,
      residentId: primaryResident?.id ?? null,
      cardToken,
    })
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
    if (preview) return Response.json({ status: 'auto_approved', preview: true, paymentsEnabled }) // dry run: no writes
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
    // P54 — payment step token (see the email-match branch above).
    const cardToken = paymentsEnabled
      ? await mintSignupCardToken({ residentId: m.resident.id, facilityId: facility.id, portalAccountId }).catch(() => null)
      : null
    return Response.json({
      status: 'auto_approved',
      paymentsEnabled: paymentsEnabled && !!cardToken,
      residentId: m.resident.id,
      cardToken,
    })
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

  // ── P54 UNIFORM ACCOUNT MODEL (Josh, Fitzgerald meeting) ──────────────────
  // No pending dead-end: when the match is NOT confident, create a brand-new
  // resident RIGHT NOW (the applicant becomes the POA/contact), link the
  // account, and the family proceeds like everyone else. The admin reviews
  // keep-or-merge afterward (near-miss candidate stored as
  // mergeSuggestionResidentId for one-tap merge; ambiguous ties never
  // pre-pick — P53 doctrine).

  // P53 dry-run exit: the full match + confidence derivation ran above; stop
  // before ANY write (resident/account/claim/coupon/emails/bells).
  if (preview) return Response.json({ status: 'created', preview: true, paymentsEnabled })

  // Idempotency: the submit button disables in flight and a later re-POST hits
  // the top-of-route 409, but a racing double-tap could slip both requests past
  // it — re-check the active-link guard just before creating a resident.
  const linkRecheck = await db
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
  if (linkRecheck.length > 0) return Response.json({ status: 'created', paymentsEnabled: false })

  // Create the resident from what the family told us (same shape as the
  // admin approve-createResident branch): portalToken so booking-confirmation
  // emails work; poaEmail is the portal login identity.
  const [newResident] = await db
    .insert(residents)
    .values({
      facilityId: facility.id,
      name: (claimedResidentName || fullName).trim(),
      roomNumber: roomNumber?.trim() || null,
      poaName: relationship === 'self' ? null : fullName,
      poaEmail: normalizedEmail,
      poaPhone: phone ?? null,
      portalToken: randomBytes(8).toString('hex'),
    })
    .returning({ id: residents.id, name: residents.name, roomNumber: residents.roomNumber })

  const portalAccountId = await upsertAccountAndLink({
    email: normalizedEmail,
    fullName,
    phone: phone ?? null,
    dateOfBirth: dateOfBirth ?? null,
    facilityId: facility.id,
    residentIds: [newResident.id],
  })

  // Review-queue row — NOT best-effort: this IS the admin's keep-or-merge card.
  await db.insert(portalClaimRequests).values({
    facilityId: facility.id,
    facilityCode: facility.facilityCode ?? facilityCode,
    email: normalizedEmail,
    fullName,
    phone: phone ?? null,
    dateOfBirth: dateOfBirth ?? null,
    residentName: claimedResidentName || null,
    roomNumber: roomNumber?.trim() || null,
    relationship: relationship ?? null,
    residentId: newResident.id,
    mergeSuggestionResidentId: ambiguous ? null : bestMatch?.resident.id ?? null,
    matchType: ambiguous ? null : bestMatch?.type ?? null,
    matchConfidence: confidence,
    familyConfirmed: familyConfirmed && m?.confident ? true : null,
    status: 'auto_created',
  })

  await issueWelcomeCoupon(facility.id, portalAccountId, newResident.id).catch(() => {})

  // Notify facility admin (fire-and-forget) — reworded for the new model.
  const adminEmail = facility.contactEmail ?? process.env.NEXT_PUBLIC_ADMIN_EMAIL
  if (adminEmail) {
    const settingsUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/settings?section=portal`
    sendEmail({
      to: adminEmail,
      subject: `New family account — ${facility.name}`,
      html: buildClaimRequestEmailHtml({ fullName, email: normalizedEmail, facilityName: facility.name, settingsUrl, residentName: newResident.name }),
    }).catch(() => {})
  }

  // P50 — in-app bell for every facility admin (email alone rots unwatched).
  import('@/lib/notify').then(({ notifyFacilityAdmins }) =>
    notifyFacilityAdmins(facility.id, {
      type: 'portal_claim',
      title: 'New family account created',
      body: `${fullName} signed up — a new resident "${newResident.name}" was created. Review or merge it in Settings.`,
      url: '/settings?section=portal',
    }),
  ).catch(() => {})

  // Magic link — AWAITED (the family's sign-in path; user-initiated send).
  const magicLink = await createMagicLink(normalizedEmail, newResident.id, facility.facilityCode ?? facilityCode)
  await sendEmail({
    to: normalizedEmail,
    subject: `Welcome to the ${facility.name} Family Portal`,
    html: buildPortalMagicLinkEmailHtml({ residentNames: [newResident.name], facilityName: facility.name, link: magicLink, expiresInHours: 72 }),
  })

  // P54 — AUTO-CREATED signups get a real portal session so the payment step
  // (and "Go to my account") work immediately. 7 days, not 30 — this session
  // was never email-verified, which bounds the blast radius if the admin later
  // merges the resident away. The magic link above remains the long-term path.
  try {
    const sessionToken = await createPortalSession(portalAccountId, 7)
    await setPortalSessionCookie(sessionToken, 7)
  } catch (err) {
    console.error('[portal signup] session mint failed (magic link still works):', err)
  }

  return Response.json({ status: 'created', paymentsEnabled, residentId: newResident.id })
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// P54 — the account-upsert + resident-link core, shared by autoApprove (matched
// residents) and the uniform-model auto-create branch (brand-new resident).
async function upsertAccountAndLink(opts: {
  email: string
  fullName: string
  phone: string | null
  dateOfBirth: string | null
  facilityId: string
  residentIds: string[]
}): Promise<string> {
  const { email, fullName, phone, dateOfBirth, facilityId, residentIds } = opts

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

  for (const residentId of residentIds) {
    await db
      .insert(portalAccountResidents)
      .values({ portalAccountId, residentId, facilityId })
      .onConflictDoNothing()
  }

  return portalAccountId
}

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

  const portalAccountId = await upsertAccountAndLink({
    email,
    fullName,
    phone,
    dateOfBirth,
    facilityId,
    residentIds: matchedResidents.map((r) => r.id),
  })

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

// P54 — reworded for the uniform model: the signup already CREATED a resident;
// the admin's job is keep-or-merge, not approve-or-reject.
function buildClaimRequestEmailHtml(params: {
  fullName: string
  email: string
  facilityName: string
  settingsUrl: string
  residentName: string
}): string {
  const { fullName, email, facilityName, settingsUrl, residentName } = params
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;">New Family Account</h1>
      <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">${facilityName}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 16px;color:#1C1917;font-size:15px;line-height:1.6;">
        <strong>${fullName}</strong> (${email}) signed up and a new resident record
        &ldquo;<strong>${residentName}</strong>&rdquo; was created for them.
      </p>
      <p style="margin:0 0 24px;color:#57534E;font-size:14px;line-height:1.5;">
        If this resident already exists under a different spelling, merge the two in
        Settings → Family Portal — otherwise keep it and you're done.
      </p>
      <p style="margin:0;">
        <a href="${settingsUrl}" style="display:inline-block;background:#8B2E4A;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:600;">Review New Account</a>
      </p>
    </div>
  </div>
</body>
</html>`.trim()
}
