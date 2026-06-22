import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { pushSubscriptions } from '@/db/schema'
import { ensurePushSchema } from '@/lib/push-ddl'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().max(200),
  auth: z.string().max(200),
})

export async function POST(request: Request) {
  try {
    await ensurePushSchema()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = subscribeSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 422 })

    const { endpoint, p256dh, auth } = parsed.data

    // Upsert: update keys if endpoint already exists for this user
    const existing = await db.query.pushSubscriptions.findFirst({
      where: and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)),
    })

    if (existing) {
      await db.update(pushSubscriptions)
        .set({ p256dh, auth })
        .where(eq(pushSubscriptions.id, existing.id))
    } else {
      await db.insert(pushSubscriptions).values({ userId: user.id, endpoint, p256dh, auth })
    }

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[POST /api/push/subscribe] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
