import {
  accountHasResidentAtFacilityCode,
  createPortalSession,
  findAccountByEmail,
  setPortalSessionCookie,
  touchAccountLogin,
} from '@/lib/portal-auth'
import { verifyPassword } from '@/lib/portal-password'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
  facilityCode: z.string().min(2).max(20),
})

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const rl = await checkRateLimit('portalLogin', ip)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const { email, password, facilityCode } = parsed.data
    const account = await findAccountByEmail(email)
    if (!account || !account.passwordHash) {
      return Response.json({ error: 'Invalid email or password' }, { status: 401 })
    }
    const ok = await verifyPassword(password, account.passwordHash)
    if (!ok) {
      return Response.json({ error: 'Invalid email or password' }, { status: 401 })
    }
    const hasAccess = await accountHasResidentAtFacilityCode(account.id, facilityCode)
    if (!hasAccess) {
      return Response.json({ error: 'Invalid email or password' }, { status: 401 })
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
