import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, accessRequests, profiles, stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    // Admin only
    if (facilityUser.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 })
    }

    const existing = await db.query.invites.findFirst({
      where: and(eq(invites.id, id), eq(invites.facilityId, facilityId)),
    })

    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })
    if (existing.used) {
      return Response.json({ error: 'Cannot revoke a used invite' }, { status: 409 })
    }

    await db.delete(invites).where(and(eq(invites.id, id), eq(invites.facilityId, facilityId)))

    // Clean up any pending access requests for this email at this facility
    await db
      .delete(accessRequests)
      .where(
        and(
          eq(accessRequests.email, existing.email),
          eq(accessRequests.facilityId, facilityId),
          eq(accessRequests.status, 'pending')
        )
      )

    // If a profile with this email has a stylist linked at this facility, free it
    const profileForEmail = await db.query.profiles.findFirst({
      where: eq(profiles.email, existing.email),
      columns: { id: true, stylistId: true },
    })
    if (profileForEmail?.stylistId) {
      const linkedStylist = await db.query.stylists.findFirst({
        where: and(
          eq(stylists.id, profileForEmail.stylistId),
          eq(stylists.facilityId, facilityId)
        ),
        columns: { id: true },
      })
      if (linkedStylist) {
        await db
          .update(profiles)
          .set({ stylistId: null, updatedAt: new Date() })
          .where(eq(profiles.id, profileForEmail.id))
      }
    }

    return Response.json({ data: { id } })
  } catch (err) {
    console.error('DELETE /api/invites/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
