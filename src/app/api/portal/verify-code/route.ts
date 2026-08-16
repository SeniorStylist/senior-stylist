// P55 — SMS-code login, step 2: verify the texted code and mint a portal
// session. A verified code is a VERIFIED entry — it also activates any signup
// password held on a claim row (applyHeldClaimPassword, the anti-takeover
// rule's phone channel). ≤5 attempts per code, constant-time compare,
// single-use.

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { portalLoginCodes } from '@/db/schema'
import { normalizePhoneDigits } from '@/lib/phone'
import {
  accountHasResidentAtFacilityCode,
  applyHeldClaimPassword,
  createPortalSession,
  findAccountByIdentifier,
  setPortalSessionCookie,
  touchAccountLogin,
} from '@/lib/portal-auth'
import { ensurePortalIdentitySchema } from '@/lib/portal-identity-ddl'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const schema = z.object({
  phone: z.string().min(7).max(30),
  code: z.string().regex(/^\d{6}$/),
  facilityCode: z.string().trim().min(1).max(50),
})

const GENERIC = 'That code is wrong or expired — request a new one.'

export async function POST(request: NextRequest) {
  try {
    if (process.env.TWILIO_ENABLED !== 'true') {
      return Response.json(
        { error: "Text sign-in isn't set up yet — use your password or an email link instead." },
        { status: 503 },
      )
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const rl = await checkRateLimit('portalVerifyCode', `ip:${ip}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const body = await request.json().catch(() => null)
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: GENERIC }, { status: 401 })

    await ensurePortalIdentitySchema()

    const digits = normalizePhoneDigits(parsed.data.phone)
    const account = await findAccountByIdentifier(digits)
    if (!account) return Response.json({ error: GENERIC }, { status: 401 })

    // Newest live code for this account.
    const codeRow = await db.query.portalLoginCodes.findFirst({
      where: and(
        eq(portalLoginCodes.portalAccountId, account.id),
        isNull(portalLoginCodes.consumedAt),
        gt(portalLoginCodes.expiresAt, new Date()),
      ),
      orderBy: [desc(portalLoginCodes.createdAt)],
      columns: { id: true, codeHash: true, attempts: true },
    })
    if (!codeRow || codeRow.attempts >= 5) return Response.json({ error: GENERIC }, { status: 401 })

    // Count the attempt BEFORE comparing (a crash can't grant free tries).
    await db
      .update(portalLoginCodes)
      .set({ attempts: sql`${portalLoginCodes.attempts} + 1` })
      .where(eq(portalLoginCodes.id, codeRow.id))

    const supplied = createHash('sha256').update(parsed.data.code).digest()
    const stored = Buffer.from(codeRow.codeHash, 'hex')
    const ok = supplied.length === stored.length && timingSafeEqual(supplied, stored)
    if (!ok) return Response.json({ error: GENERIC }, { status: 401 })

    if (!(await accountHasResidentAtFacilityCode(account.id, parsed.data.facilityCode))) {
      return Response.json({ error: GENERIC }, { status: 401 })
    }

    // Consume, mint the session, activate any held signup password.
    await db.update(portalLoginCodes).set({ consumedAt: new Date() }).where(eq(portalLoginCodes.id, codeRow.id))
    const token = await createPortalSession(account.id, 30)
    await setPortalSessionCookie(token, 30)
    await touchAccountLogin(account.id)
    await applyHeldClaimPassword(account.id)

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/portal/verify-code error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
