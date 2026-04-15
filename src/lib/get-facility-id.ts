import { cookies } from 'next/headers'
import { db } from '@/db'
import { facilityUsers, franchiseFacilities, franchises } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Normalize 'super_admin' → 'admin' so page guards and API guards
 * work uniformly for franchise owners without touching every call site.
 * The Super Admin page/link is gated by NEXT_PUBLIC_SUPER_ADMIN_EMAIL
 * (email match), not by role, so this normalization is safe.
 */
function normalizeRole<T extends { role: string }>(fu: T): T {
  return fu.role === 'super_admin' ? { ...fu, role: 'admin' } : fu
}

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
      if (fu) return normalizeRole(fu)
    }

    const row = await db.query.facilityUsers.findFirst({
      where: eq(facilityUsers.userId, userId),
    })
    return row ? normalizeRole(row) : null
  } catch (err) {
    console.error('[getUserFacility] DB error:', err)
    return null
  }
}

export async function getUserFranchise(userId: string): Promise<{
  franchiseId: string
  franchiseName: string
  facilityIds: string[]
} | null> {
  try {
    const fu = await getUserFacility(userId)
    if (!fu) return null

    const membership = await db
      .select({
        franchiseId: franchiseFacilities.franchiseId,
        franchiseName: franchises.name,
      })
      .from(franchiseFacilities)
      .innerJoin(franchises, eq(franchises.id, franchiseFacilities.franchiseId))
      .where(eq(franchiseFacilities.facilityId, fu.facilityId))
      .limit(1)

    if (!membership.length) return null
    const { franchiseId, franchiseName } = membership[0]

    const siblings = await db
      .select({ facilityId: franchiseFacilities.facilityId })
      .from(franchiseFacilities)
      .where(eq(franchiseFacilities.franchiseId, franchiseId))

    return {
      franchiseId,
      franchiseName,
      facilityIds: siblings.map((s) => s.facilityId),
    }
  } catch (err) {
    console.error('[getUserFranchise] DB error:', err)
    return null
  }
}
