import { NextRequest } from 'next/server'
import { db } from '@/db'
import { facilities, facilityUsers, profiles } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { cookies } from 'next/headers'

export async function GET(_request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const facilityId = cookieStore.get('selected_facility_id')?.value

    if (!facilityId) {
      return Response.json({ email: null })
    }

    const facility = await db.query.facilities.findFirst({
      where: (t) => eq(t.id, facilityId),
    })

    if (!facility) {
      return Response.json({ email: null })
    }

    // Use contactEmail if set
    if (facility.contactEmail) {
      return Response.json({ email: facility.contactEmail })
    }

    // Fall back to the first admin's email for this facility
    const adminFU = await db
      .select({ email: profiles.email })
      .from(facilityUsers)
      .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
      .where(and(eq(facilityUsers.facilityId, facilityId), eq(facilityUsers.role, 'admin')))
      .limit(1)

    const email = adminFU[0]?.email ?? null
    return Response.json({ email })
  } catch (err) {
    console.error('GET /api/facilities/admin-contact error:', err)
    return Response.json({ email: null })
  }
}
