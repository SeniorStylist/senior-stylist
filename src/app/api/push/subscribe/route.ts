import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { pushSubscriptions } from '@/db/schema'
import { ensurePushSchema } from '@/lib/push-ddl'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'

// Web-push shape (service-worker subscription) OR native shape (N3 — FCM device
// token from the Capacitor shell; stored in the endpoint column, no keys).
const subscribeSchema = z.union([
  z.object({
    endpoint: z.string().url().max(2000),
    p256dh: z.string().max(200),
    auth: z.string().max(200),
  }),
  z.object({
    platform: z.enum(['ios', 'android']),
    token: z.string().min(10).max(2000),
  }),
])

export async function POST(request: Request) {
  try {
    await ensurePushSchema()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = subscribeSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 422 })

    // Normalize both shapes onto the row model
    const row =
      'token' in parsed.data
        ? { endpoint: parsed.data.token, p256dh: null, auth: null, platform: parsed.data.platform }
        : { endpoint: parsed.data.endpoint, p256dh: parsed.data.p256dh, auth: parsed.data.auth, platform: 'web' }

    // Upsert: update keys/platform if endpoint already exists for this user
    const existing = await db.query.pushSubscriptions.findFirst({
      where: and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, row.endpoint)),
    })

    if (existing) {
      await db.update(pushSubscriptions)
        .set({ p256dh: row.p256dh, auth: row.auth, platform: row.platform })
        .where(eq(pushSubscriptions.id, existing.id))
    } else {
      await db.insert(pushSubscriptions).values({ userId: user.id, ...row })
    }

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[POST /api/push/subscribe] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
