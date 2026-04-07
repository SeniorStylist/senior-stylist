import { db } from '@/db'
import { facilities, franchises, franchiseFacilities } from '@/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Returns the list of facility IDs the caller is authorized to query.
 * - Master admin (NEXT_PUBLIC_SUPER_ADMIN_EMAIL): all active facilities
 * - Super admin: only facilities in their owned franchise(s)
 * - Anyone else: empty array (caller should 403)
 */
export async function getSuperAdminFacilities(
  userId: string,
  userEmail: string
): Promise<string[]> {
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (superAdminEmail && userEmail === superAdminEmail) {
    const all = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(eq(facilities.active, true))
    return all.map((f) => f.id)
  }

  // Super admin: only facilities in franchises they own
  const owned = await db
    .select({ facilityId: franchiseFacilities.facilityId })
    .from(franchiseFacilities)
    .innerJoin(franchises, eq(franchises.id, franchiseFacilities.franchiseId))
    .where(eq(franchises.ownerUserId, userId))
  return owned.map((r) => r.facilityId)
}
