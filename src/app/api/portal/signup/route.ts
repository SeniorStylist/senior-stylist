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
import { sendEmail, buildPortalMagicLinkEmailHtml } from '@/lib/email'
import { fuzzyScore } from '@/lib/fuzzy'

export const dynamic = 'force-dynamic'

const signupSchema = z.object({
  email: z.string().email().max(320),
  fullName: z.string().min(2).max(200),
  facilityCode: z.string().min(1).max(50),
  phone: z.string().max(30).optional().nullable(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = await checkRateLimit('portalSignup', ip)
  if (!rl.ok) return rateLimitResponse(rl.retryAfter)

  const body = await request.json().catch(() => null)
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  const parsed = signupSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 })

  const { email, fullName, facilityCode, phone, dateOfBirth } = parsed.data
  const normalizedEmail = email.toLowerCase().trim()

  const facility = await db.query.facilities.findFirst({
    where: and(eq(facilities.facilityCode, facilityCode), eq(facilities.active, true)),
    columns: {
      id: true, name: true, facilityCode: true, contactEmail: true,
      portalSelfSignupEnabled: true,
      portalCouponsEnabled: true,
      portalWelcomeCouponEnabled: true,
    },
  })
  if (!facility) return Response.json({ error: 'Facility not found' }, { status: 404 })
  if (!facility.portalSelfSignupEnabled) {
    return Response.json({ error: 'Self-signup is not available for this facility.' }, { status: 403 })
  }

  // Check if already linked to a resident at this facility
  const existingAccount = await db.query.portalAccounts.findFirst({
    where: eq(portalAccounts.email, normalizedEmail),
    columns: { id: true },
    with: {
      accountResidents: {
        where: eq(portalAccountResidents.facilityId, facility.id),
        columns: { id: true },
      },
    },
  })
  if (existingAccount && (existingAccount as { accountResidents: {id:string}[] }).accountResidents?.length > 0) {
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

  // 2. Try name match: fullName fuzzy against resident.poaName
  const facilityResidents = await db.query.residents.findMany({
    where: and(
      eq(residents.facilityId, facility.id),
      eq(residents.active, true),
      eq(residents.isDemo, false),
    ),
    columns: { id: true, name: true, poaName: true, roomNumber: true },
  })

  let bestMatch: { resident: typeof facilityResidents[0]; score: number } | null = null
  for (const r of facilityResidents) {
    if (!r.poaName) continue
    const score = fuzzyScore(fullName, r.poaName)
    if (score > (bestMatch?.score ?? 0.59)) {
      bestMatch = { resident: r, score }
    }
  }

  // Name-based matches NEVER auto-approve — only an exact POA-email match (handled
  // above) does. A name collision must always go to an admin for review, so a
  // stranger who happens to share a resident's POA name can't self-grant access to
  // that resident's billing + appointment data.
  const confidence = bestMatch
    ? (bestMatch.score >= 0.80 ? 'high' : bestMatch.score >= 0.65 ? 'medium' : 'low')
    : null

  await db.insert(portalClaimRequests).values({
    facilityId: facility.id,
    facilityCode: facility.facilityCode ?? facilityCode,
    email: normalizedEmail,
    fullName,
    phone: phone ?? null,
    dateOfBirth: dateOfBirth ?? null,
    residentId: bestMatch?.resident.id ?? null,
    matchType: bestMatch ? 'name' : null,
    matchConfidence: confidence,
    status: 'pending_review',
  })

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
}): Promise<string> {
  const { email, fullName, phone, dateOfBirth, facilityId, facilityCode, facilityName, matchedResidents, matchType, matchConfidence } = opts

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
