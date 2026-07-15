import { createClient } from '@/lib/supabase/server'
import { NextRequest } from 'next/server'
import { db } from '@/db'
import { profiles, stylists, stylistFacilityAssignments } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and, ne } from 'drizzle-orm'
import { z } from 'zod'

const updateSchema = z.object({ stylistId: z.string().uuid() })

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 403 })

    const parsed = updateSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'stylistId required' }, { status: 400 })
    const { stylistId } = parsed.data

    // Verify the stylist WORKS at the facility: home row OR an active
    // assignment row (P34 — home-only rejected assignment-linked stylists).
    const stylist = await db.query.stylists.findFirst({
      where: eq(stylists.id, stylistId),
    })
    if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })
    if (stylist.facilityId !== facilityUser.facilityId) {
      const assignment = await db.query.stylistFacilityAssignments.findFirst({
        where: and(
          eq(stylistFacilityAssignments.stylistId, stylistId),
          eq(stylistFacilityAssignments.facilityId, facilityUser.facilityId),
          eq(stylistFacilityAssignments.active, true),
        ),
        columns: { id: true },
      })
      if (!assignment) return Response.json({ error: 'Stylist not found' }, { status: 404 })
    }

    // Reject if the stylist is already linked to a different user (prevents takeover)
    const existingLink = await db.query.profiles.findFirst({
      where: and(eq(profiles.stylistId, stylistId), ne(profiles.id, user.id)),
    })
    if (existingLink) {
      return Response.json({ error: 'This stylist is already linked to another user' }, { status: 409 })
    }

    await db.update(profiles).set({ stylistId, updatedAt: new Date() }).where(eq(profiles.id, user.id))

    return Response.json({ data: { stylistId } })
  } catch (err) {
    console.error('PUT /api/profile error:', err)
    return Response.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
