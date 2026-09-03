// P60 — the ONE authorization for endpoints that take an EXPLICIT facilityId
// (the New-Facility wizard's writes, facility-side staffing, imports with a
// target facility). The cookie-scoped `getUserFacility()` path 400s the
// master when he holds no membership row and can't express "write to THAT
// facility"; this resolves the caller's right to the named facility instead.
//
// Rules: facility must be active + non-demo → else 404. Master (email) → ok.
// Bookkeeper → any active facility (cross-facility by role). Franchise admin
// (rawRole 'super_admin') → facilities in their franchise. Anyone else needs
// an admin/super_admin facility_users row at that facility. `requireManageTier`
// additionally applies isManageTier (master / franchise admin / bookkeeper).

import { db } from '@/db'
import { facilities, facilityUsers } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getUserFacility, getUserFranchise, isManageTier } from '@/lib/get-facility-id'

type FacilityUser = Awaited<ReturnType<typeof getUserFacility>>

export type FacilityWriteResult =
  | { ok: true; facilityId: string; isMaster: boolean; fu: FacilityUser }
  | { ok: false; status: 400 | 403 | 404; error: string }

export async function resolveFacilityWrite(
  user: { id: string; email?: string | null },
  facilityId: string,
  opts?: { requireManageTier?: boolean },
): Promise<FacilityWriteResult> {
  const fac = await db.query.facilities.findFirst({
    where: and(eq(facilities.id, facilityId), eq(facilities.active, true), eq(facilities.isDemo, false)),
    columns: { id: true },
  })
  if (!fac) return { ok: false, status: 404, error: 'Facility not found' }

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  const isMaster = !!superAdminEmail && user.email === superAdminEmail
  const fu = await getUserFacility(user.id)
  if (isMaster) return { ok: true, facilityId, isMaster, fu }
  if (!fu) return { ok: false, status: 400, error: 'No facility' }

  let allowed = false
  if (fu.role === 'bookkeeper') {
    allowed = true
  } else if (fu.rawRole === 'super_admin') {
    const franchise = await getUserFranchise(user.id)
    allowed = !!franchise && franchise.facilityIds.includes(facilityId)
  } else {
    const row = await db.query.facilityUsers.findFirst({
      where: and(eq(facilityUsers.userId, user.id), eq(facilityUsers.facilityId, facilityId)),
      columns: { role: true },
    })
    allowed = !!row && (row.role === 'admin' || row.role === 'super_admin')
  }
  if (!allowed) return { ok: false, status: 403, error: 'Forbidden' }
  if (opts?.requireManageTier && !isManageTier(fu, isMaster)) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  return { ok: true, facilityId, isMaster, fu }
}
