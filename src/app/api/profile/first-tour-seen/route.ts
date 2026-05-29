import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  await db.update(profiles)
    .set({ hasSeenFirstTour: true })
    .where(eq(profiles.id, user.id))

  return Response.json({ data: { ok: true } })
}
