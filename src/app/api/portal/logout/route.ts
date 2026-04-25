import { PORTAL_SESSION_COOKIE, clearPortalSessionCookie, revokeSession } from '@/lib/portal-auth'
import { cookies } from 'next/headers'

export async function POST() {
  try {
    const store = await cookies()
    const token = store.get(PORTAL_SESSION_COOKIE)?.value
    if (token) await revokeSession(token)
    await clearPortalSessionCookie()
    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/portal/logout error:', err)
    return Response.json({ data: { ok: true } })
  }
}
