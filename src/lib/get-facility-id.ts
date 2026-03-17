import { cookies } from 'next/headers'
import { db } from '@/db'
import { facilityUsers } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Returns the facilityUser row for the current user, respecting the
 * `selected_facility_id` cookie for multi-facility accounts.
 * Falls back to the first facility if no cookie is set or if the
 * cookie references a facility the user doesn't belong to.
 */
export async function getUserFacility(userId: string) {
  try {
    const cookieStore = await cookies()
    const selected = cookieStore.get('selected_facility_id')?.value

    if (selected) {
      const fu = await db.query.facilityUsers.findFirst({
        where: and(
          eq(facilityUsers.userId, userId),
          eq(facilityUsers.facilityId, selected)
        ),
      })
      if (fu) return fu
    }

    return await db.query.facilityUsers.findFirst({
      where: eq(facilityUsers.userId, userId),
    })
  } catch (err) {
    console.error('[getUserFacility] DB error:', err)
    return null
  }
}
