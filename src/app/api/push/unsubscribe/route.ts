import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { pushSubscriptions } from '@/db/schema'
import { ensurePushSchema } from '@/lib/push-ddl'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ endpoint: z.string().url().max(2000) })

export async function POST(request: Request) {
  try {
    await ensurePushSchema()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 422 })

    await db.delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, parsed.data.endpoint)))

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[POST /api/push/unsubscribe] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
