import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { db } from '@/db'
import { profiles, stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 403 })

    const body = await request.json()
    const { stylistId } = body

    if (!stylistId) return Response.json({ error: 'stylistId required' }, { status: 400 })

    // Verify the stylist belongs to the facility
    const stylist = await db.query.stylists.findFirst({
      where: and(eq(stylists.id, stylistId), eq(stylists.facilityId, facilityUser.facilityId)),
    })
    if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })

    await db.update(profiles).set({ stylistId, updatedAt: new Date() }).where(eq(profiles.id, user.id))

    return Response.json({ data: { stylistId } })
  } catch (err) {
    console.error('PUT /api/profile error:', err)
    return Response.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
