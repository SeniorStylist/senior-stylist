import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    await db
      .update(profiles)
      .set({ hasSeenOnboardingTour: true, updatedAt: new Date() })
      .where(eq(profiles.id, user.id))

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/profile/onboarding-seen error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
