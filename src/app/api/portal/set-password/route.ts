import { db } from '@/db'
import { portalAccounts } from '@/db/schema'
import { getPortalSession } from '@/lib/portal-auth'
import { hashPassword } from '@/lib/portal-password'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({ password: z.string().min(8).max(200) })

export async function POST(request: NextRequest) {
  try {
    const session = await getPortalSession()
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('portalSetPassword', session.portalAccountId)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const hash = await hashPassword(parsed.data.password)
    await db.update(portalAccounts).set({ passwordHash: hash }).where(eq(portalAccounts.id, session.portalAccountId))

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/portal/set-password error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
