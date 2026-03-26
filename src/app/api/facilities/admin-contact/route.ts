import { NextRequest } from 'next/server'
import { db } from '@/db'
import { facilities, facilityUsers, profiles, invites } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request: NextRequest) {
  try {
    const cookieStore = await cookies()
    let facilityId = cookieStore.get('selected_facility_id')?.value

    // If no cookie, try to find facility via user's invite
    if (!facilityId) {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.email) {
        const invite = await db.query.invites.findFirst({
          where: (t) => eq(t.email, user.email!.toLowerCase()),
          orderBy: (t, { desc }) => [desc(t.createdAt)],
        })
        if (invite) {
          facilityId = invite.facilityId
        }
      }
    }

    if (!facilityId) {
      const allFacilities = await db.query.facilities.findMany({
        where: (t) => eq(t.active, true),
        orderBy: (t, { asc }) => [asc(t.name)],
        columns: { id: true, name: true, contactEmail: true },
      })
      return Response.json({ email: null, facilityId: null, facilityName: null, allFacilities })
    }

    const facility = await db.query.facilities.findFirst({
      where: (t) => eq(t.id, facilityId!),
    })

    if (!facility) {
      return Response.json({ email: null, facilityId: null, facilityName: null })
    }

    // Use contactEmail if set
    if (facility.contactEmail) {
      return Response.json({
        email: facility.contactEmail,
        facilityId: facility.id,
        facilityName: facility.name,
      })
    }

    // Fall back to the first admin's email for this facility
    const adminFU = await db
      .select({ email: profiles.email })
      .from(facilityUsers)
      .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
      .where(and(eq(facilityUsers.facilityId, facilityId), eq(facilityUsers.role, 'admin')))
      .limit(1)

    return Response.json({
      email: adminFU[0]?.email ?? null,
      facilityId: facility.id,
      facilityName: facility.name,
    })
  } catch (err) {
    console.error('GET /api/facilities/admin-contact error:', err)
    return Response.json({ email: null, facilityId: null, facilityName: null })
  }
}
