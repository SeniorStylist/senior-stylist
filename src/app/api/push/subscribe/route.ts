import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { pushSubscriptions } from '@/db/schema'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const schema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().max(500),
  auth: z.string().max(500),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid subscription' }, { status: 400 })

    const { endpoint, p256dh, auth } = parsed.data

    // Upsert: if this endpoint already exists for any user, update to current user
    await db
      .insert(pushSubscriptions)
      .values({ userId: user.id, endpoint, p256dh, auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.id, p256dh, auth },
      })

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[push/subscribe] error:', err)
    return Response.json({ error: 'Failed to save subscription' }, { status: 500 })
  }
}
