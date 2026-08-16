// P55 — SMS-code login, step 1: text a 6-digit code to a phone that belongs to
// a portal account with a resident at this facility. DORMANT until
// TWILIO_ENABLED='true' (503 with a friendly message otherwise).
//
// Anti-enumeration: the response is ALWAYS { sent: true } when Twilio is on —
// mirroring request-link's doctrine — so a probe can't learn which phones have
// accounts. Rate limits are per-phone AND per-IP (each real send costs an SMS).

import { createHash, randomInt } from 'node:crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { portalLoginCodes } from '@/db/schema'
import { normalizePhoneDigits } from '@/lib/phone'
import { findAccountByIdentifier, accountHasResidentAtFacilityCode } from '@/lib/portal-auth'
import { ensurePortalIdentitySchema } from '@/lib/portal-identity-ddl'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { sendSms } from '@/lib/sms'

export const dynamic = 'force-dynamic'

const schema = z.object({
  phone: z.string().min(7).max(30),
  facilityCode: z.string().trim().min(1).max(50),
})

export async function POST(request: NextRequest) {
  try {
    if (process.env.TWILIO_ENABLED !== 'true') {
      return Response.json(
        { error: "Text sign-in isn't set up yet — use your password or an email link instead." },
        { status: 503 },
      )
    }

    const body = await request.json().catch(() => null)
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const digits = normalizePhoneDigits(parsed.data.phone)
    if (digits.length < 7) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const rlPhone = await checkRateLimit('portalRequestCode', `p:${digits}`)
    if (!rlPhone.ok) return rateLimitResponse(rlPhone.retryAfter)
    const rlIp = await checkRateLimit('portalRequestCode', `ip:${ip}`)
    if (!rlIp.ok) return rateLimitResponse(rlIp.retryAfter)

    await ensurePortalIdentitySchema()

    const account = await findAccountByIdentifier(digits)
    if (account && (await accountHasResidentAtFacilityCode(account.id, parsed.data.facilityCode))) {
      const code = String(randomInt(100000, 1000000)) // 6 digits, crypto RNG
      await db.insert(portalLoginCodes).values({
        portalAccountId: account.id,
        codeHash: createHash('sha256').update(code).digest('hex'),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      // sendSms never throws; a delivery failure looks identical to a wrong
      // phone from the outside (anti-enumeration).
      sendSms(parsed.data.phone, `Your Senior Stylist sign-in code is ${code}. It expires in 10 minutes.`).catch(() => {})
    }

    return Response.json({ data: { sent: true } })
  } catch (err) {
    console.error('POST /api/portal/request-code error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
