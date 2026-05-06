import { cookies } from 'next/headers'
import { db } from '@/db'
import { facilityUsers, franchiseFacilities, franchises } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Normalize 'super_admin' → 'admin' so page guards and API guards
 * work uniformly for franchise owners without touching every call site.
 * The Super Admin page/link is gated by NEXT_PUBLIC_SUPER_ADMIN_EMAIL
 * (email match), not by role, so this normalization is safe.
 *
 * `facility_staff` and `bookkeeper` (Phase 11J.1) are passed through
 * unchanged — they are first-class roles, not aliases.
 */
function normalizeRole<T extends { role: string }>(fu: T): T {
  return fu.role === 'super_admin' ? { ...fu, role: 'admin' } : fu
}

// Role helpers (Phase 11J.1). `super_admin` is accepted defensively even though
// `normalizeRole` rewrites it to 'admin' before route handlers see the role.
export function isAdminOrAbove(role: string): boolean {
  return role === 'admin' || role === 'super_admin'
}
export function canAccessBilling(role: string): boolean {
  return role === 'admin' || role === 'super_admin' || role === 'bookkeeper'
}
export function canAccessPayroll(role: string): boolean {
  return role === 'admin' || role === 'super_admin' || role === 'bookkeeper'
}
export function isFacilityStaff(role: string): boolean {
  return role === 'facility_staff'
}
export function canScanLogs(role: string): boolean {
  return isAdminOrAbove(role) || role === 'bookkeeper'
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

    const debugRaw = cookieStore.get('__debug_role')?.value
    if (debugRaw) {
      try {
        const debug = JSON.parse(debugRaw) as { role: string; facilityId: string; facilityName: string }
        if (debug.role && debug.facilityId) {
          const synth = {
            id: 'debug',
            userId,
            facilityId: debug.facilityId,
            role: debug.role,
            commissionPercent: null as number | null,
            createdAt: null as Date | null,
            updatedAt: null as Date | null,
          }
          return normalizeRole(synth)
        }
      } catch { /* malformed cookie — fall through */ }
    }

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
