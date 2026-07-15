import { NextRequest } from 'next/server'
import { z } from 'zod'
import { and, eq, ne } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { facilityUsers, profiles, stylists, stylistFacilityAssignments } from '@/db/schema'

// Admin-assigns (or unlinks) the stylist directory record for a team member's
// login. Mirrors PUT /api/profile (self-link) but targets an arbitrary userId
// in the admin's facility. The link lives on profiles.stylist_id and drives the
// stylist-scoped daily log / check-in / export views.
const bodySchema = z.object({
  stylistId: z.string().uuid().nullable(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const facilityId = facilityUser.facilityId

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'stylistId required (uuid or null)' }, { status: 400 })
    const { stylistId } = parsed.data

    // Target user must be a member of this facility.
    const targetRow = await db.query.facilityUsers.findFirst({
      where: and(eq(facilityUsers.facilityId, facilityId), eq(facilityUsers.userId, userId)),
    })
    if (!targetRow) return Response.json({ error: 'User not found in this facility' }, { status: 404 })

    let stylistName: string | null = null

    if (stylistId !== null) {
      // P34 — the stylist must WORK at this facility: home row OR an active
      // stylist_facility_assignments row. The old home-only check rejected
      // assignment-linked stylists (e.g. Senait at F177) that the P33 picker
      // correctly lists — same F228 roster bug class, validation layer.
      const stylist = await db.query.stylists.findFirst({
        where: and(eq(stylists.id, stylistId), eq(stylists.active, true)),
        columns: { id: true, name: true, facilityId: true },
      })
      if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })
      if (stylist.facilityId !== facilityId) {
        const assignment = await db.query.stylistFacilityAssignments.findFirst({
          where: and(
            eq(stylistFacilityAssignments.stylistId, stylistId),
            eq(stylistFacilityAssignments.facilityId, facilityId),
            eq(stylistFacilityAssignments.active, true),
          ),
          columns: { id: true },
        })
        if (!assignment) {
          return Response.json({ error: 'Stylist not found at this facility' }, { status: 404 })
        }
      }

      // Takeover guard — a stylist record can be linked to only one login.
      const existingLink = await db.query.profiles.findFirst({
        where: and(eq(profiles.stylistId, stylistId), ne(profiles.id, userId)),
        columns: { id: true },
      })
      if (existingLink) {
        return Response.json({ error: 'This stylist is already linked to another team member' }, { status: 409 })
      }

      stylistName = stylist.name
    }

    await db
      .update(profiles)
      .set({ stylistId, updatedAt: new Date() })
      .where(eq(profiles.id, userId))

    return Response.json({ data: { stylistId, stylistName } })
  } catch (err) {
    console.error('PUT /api/facility/users/[userId]/stylist error:', err)
    return Response.json({ error: 'Failed to update stylist link' }, { status: 500 })
  }
}
