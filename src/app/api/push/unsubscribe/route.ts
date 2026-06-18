import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { pushSubscriptions } from '@/db/schema'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'

const schema = z.object({
  endpoint: z.string().url().max(2000),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })

    await db
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, user.id),
          eq(pushSubscriptions.endpoint, parsed.data.endpoint)
        )
      )

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[push/unsubscribe] error:', err)
    return Response.json({ error: 'Failed to remove subscription' }, { status: 500 })
  }
}
