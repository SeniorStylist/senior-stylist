import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { notifications } from '@/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { ensureNotificationsSchema } from '@/lib/notifications-ddl'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

// Per-user resource — rows are keyed to user_id, so auth alone scopes reads
// (no facility lookup needed).
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('notifications', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    await ensureNotificationsSchema()

    const [rows, unreadRows] = await Promise.all([
      db.query.notifications.findMany({
        where: eq(notifications.userId, user.id),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
        limit: 30,
        columns: { id: true, type: true, title: true, body: true, url: true, readAt: true, createdAt: true },
      }),
      db
        .select({ n: sql<number>`count(*)` })
        .from(notifications)
        .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    ])
    const unreadCount = Number(unreadRows[0]?.n ?? 0)

    return Response.json({ data: { notifications: rows, unreadCount } })
  } catch (err) {
    console.error('GET /api/notifications error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
