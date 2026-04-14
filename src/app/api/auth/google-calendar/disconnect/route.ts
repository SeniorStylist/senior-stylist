import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { profiles, stylists } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { NextRequest } from 'next/server'

export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
    })
    if (!profile?.stylistId) {
      return Response.json({ error: 'No stylist linked to this account' }, { status: 400 })
    }

    await db
      .update(stylists)
      .set({ googleRefreshToken: null, googleCalendarId: null, updatedAt: new Date() })
      .where(eq(stylists.id, profile.stylistId))

    return Response.json({ data: { disconnected: true } })
  } catch (err) {
    console.error('Google Calendar disconnect error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
