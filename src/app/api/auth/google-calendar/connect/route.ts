import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { getAuthUrl } from '@/lib/google-calendar/oauth-client'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
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

    const url = getAuthUrl(profile.stylistId)
    return NextResponse.redirect(url)
  } catch (err) {
    console.error('Google Calendar connect error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
