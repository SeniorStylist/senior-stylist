import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { notifications } from '@/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { ensureNotificationsSchema } from '@/lib/notifications-ddl'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

const schema = z.object({
  // Omitted = mark ALL unread as read.
  ids: z.array(z.string().uuid()).max(100).optional(),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('notifications', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    await ensureNotificationsSchema()

    // Scoped to the caller's own rows — ids from another user are simply unmatched.
    const conditions = [eq(notifications.userId, user.id), isNull(notifications.readAt)]
    if (parsed.data.ids && parsed.data.ids.length > 0) {
      conditions.push(inArray(notifications.id, parsed.data.ids))
    }
    await db.update(notifications).set({ readAt: new Date() }).where(and(...conditions))

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/notifications/read error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
