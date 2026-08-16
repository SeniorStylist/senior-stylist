import {
  accountHasResidentAtFacilityCode,
  linkResidentsForEmail,
  createPortalSession,
  findAccountByIdentifier,
  setPortalSessionCookie,
  touchAccountLogin,
} from '@/lib/portal-auth'
import { verifyPassword } from '@/lib/portal-password'
import { ensurePortalIdentitySchema } from '@/lib/portal-identity-ddl'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// P55 — the username is email OR phone. `identifier` is the new field; `email`
// stays accepted as a back-compat alias for stale SW-cached login pages.
const schema = z
  .object({
    identifier: z.string().trim().min(3).max(320).optional(),
    email: z.string().trim().min(3).max(320).optional(),
    password: z.string().min(1).max(200),
    facilityCode: z.string().trim().min(1).max(50), // P53 — normalized bounds; lookup is case-insensitive
  })
  .refine((d) => !!d.identifier || !!d.email, { message: 'identifier required' })

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const rl = await checkRateLimit('portalLogin', ip)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    // P55 — identity columns must exist before the phone lookup (pre-migration
    // deploys must not break sign-in).
    await ensurePortalIdentitySchema()

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid email/phone or password' }, { status: 401 })
    }

    const { identifier, email, password, facilityCode } = parsed.data
    const account = await findAccountByIdentifier((identifier ?? email ?? '').trim())
    if (!account || !account.passwordHash) {
      return Response.json({ error: 'Invalid email/phone or password' }, { status: 401 })
    }
    const ok = await verifyPassword(password, account.passwordHash)
    if (!ok) {
      return Response.json({ error: 'Invalid email/phone or password' }, { status: 401 })
    }
    // P36 — auto-discovery parity with magic-link verify: link any residents
    // whose poaEmail matches this account before checking facility access.
    // (Phone-only accounts have no email to discover by — their links were
    // written at signup.)
    if (account.email) {
      await linkResidentsForEmail(account.id, account.email).catch(() => {})
    }
    const hasAccess = await accountHasResidentAtFacilityCode(account.id, facilityCode)
    if (!hasAccess) {
      return Response.json({ error: 'Invalid email/phone or password' }, { status: 401 })
    }

    const token = await createPortalSession(account.id, 30)
    await setPortalSessionCookie(token, 30)
    await touchAccountLogin(account.id)

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/portal/login error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
