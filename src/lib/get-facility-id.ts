import { cookies } from 'next/headers'
import { cache } from 'react'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { db } from '@/db'
import { facilities, facilityUsers, franchiseFacilities, franchises } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Verifies that `userId` is the master admin (NEXT_PUBLIC_SUPER_ADMIN_EMAIL).
 * Looks the email up server-side via the service-role admin API — the caller
 * NEVER supplies the email, so it cannot be spoofed. Used to gate the
 * `__debug_role` impersonation cookie, which is `httpOnly: false` and therefore
 * writable by any client; without this check, any signed-in user could forge it
 * to impersonate admin of any facility.
 */
async function isMasterAdmin(userId: string): Promise<boolean> {
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail) return false
  try {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) return false
    return data.user.email === superAdminEmail
  } catch (err) {
    console.error('[isMasterAdmin] lookup failed:', err)
    return false
  }
}

/**
 * Normalize 'super_admin' → 'admin' so page guards and API guards
 * work uniformly for franchise owners without touching every call site.
 * The Super Admin page/link is gated by NEXT_PUBLIC_SUPER_ADMIN_EMAIL
 * (email match), not by role, so this normalization is safe.
 *
 * `facility_staff` and `bookkeeper` (Phase 11J.1) are passed through
 * unchanged — they are first-class roles, not aliases.
 *
 * P51 — the ORIGINAL role survives as `rawRole` on every returned row.
 * This is what lets the manage-tier helpers below distinguish a franchise
 * admin (rawRole 'super_admin') from a facility admin (rawRole 'admin')
 * AFTER normalization — bare `role === 'admin'` guards cannot.
 */
function normalizeRole<T extends { role: string }>(fu: T): T & { rawRole: string } {
  return fu.role === 'super_admin'
    ? { ...fu, role: 'admin', rawRole: 'super_admin' }
    : { ...fu, rawRole: fu.role }
}

// Role helpers (Phase 11J.1). `super_admin` is accepted defensively even though
// `normalizeRole` rewrites it to 'admin' before route handlers see the role.
export function isAdminOrAbove(role: string): boolean {
  return role === 'admin' || role === 'super_admin'
}
export function canAccessBilling(role: string): boolean {
  return role === 'admin' || role === 'super_admin' || role === 'bookkeeper'
}
// P51 — RENAMED from canAccessPayroll: this admin-inclusive check now guards
// only QuickBooks CONNECTION infrastructure (connect/disconnect/accounts/
// vendor sync) — facility admins keep Billing, and QB connect lives there.
// Payroll itself moved to the manage tier: use canAccessPayrollFu (below).
export function canManageQuickBooksBilling(role: string): boolean {
  return role === 'admin' || role === 'super_admin' || role === 'bookkeeper'
}
export function isFacilityStaff(role: string): boolean {
  return role === 'facility_staff'
}
export function canScanLogs(role: string): boolean {
  return isAdminOrAbove(role) || role === 'bookkeeper'
}

/**
 * P51 — the "manage tier": who may see/edit stylist compensation + personal
 * info, manage the directory/applicants, edit the service catalog, and run
 * payroll. Facility-side roles (facility admin, front desk) are explicitly
 * OUT — facilities see rosters and schedules, never pay or PII (Josh,
 * 2026-08-07). Franchise admins qualify via rawRole (they are normalized to
 * 'admin' — see normalizeRole); bookkeepers qualify by role ("bookkeepers do
 * a lot of front work"); master is passed in by callers that already did the
 * env-email check.
 */
type FuLike = { role: string; rawRole?: string } | null | undefined
export function isManageTier(fu: FuLike, isMaster = false): boolean {
  return isMaster || fu?.rawRole === 'super_admin' || fu?.role === 'bookkeeper'
}
export const canManageStylists = isManageTier
export const canEditServices = isManageTier
export function canAccessPayrollFu(fu: FuLike, isMaster = false): boolean {
  return isManageTier(fu, isMaster)
}

/**
 * P53 — FACILITY SCHEDULING LOCKOUT (Josh 2026-08-13, supersedes the P39
 * supervisor line for facility roles): facility admin + front desk never
 * place time slots. Everything they enter goes through the Sign-Up Sheet;
 * ONLY the stylist (plus master / franchise admin / bookkeeper) converts a
 * request into a real time slot. They keep: viewing the calendar, cancelling,
 * editing non-time booking details, and recording day-log walk-ins.
 * Uses rawRole so franchise admins (normalized to 'admin') are never caught.
 */
export function isFacilityScheduleLocked(fu: FuLike, isMaster = false): boolean {
  if (isManageTier(fu, isMaster)) return false
  return fu?.role === 'admin' || fu?.role === 'facility_staff'
}

/** The lockout's human 403 — one string everywhere so the UI reads consistent. */
export const SCHEDULE_LOCKED_MESSAGE =
  'Time slots are placed by the stylist — add this to the Sign-Up Sheet instead.'

/**
 * Returns the facilityUser row for the current user, respecting the
 * `selected_facility_id` cookie for multi-facility accounts.
 * Falls back to the first facility if no cookie is set or if the
 * cookie references a facility the user doesn't belong to.
 *
 * Phase 25 — wrapped in React.cache(): within one server-component render
 * (layout + page + nested helpers) repeated calls share a single DB query.
 * Outside a render (route handlers) cache() degrades to a plain call — same
 * behavior as before. Cookies are read inside, so the result stays
 * per-request; there is no cross-request or cross-user sharing.
 */
export const getUserFacility = cache(async function getUserFacility(userId: string) {
  try {
    const cookieStore = await cookies()

    const debugRaw = cookieStore.get('__debug_role')?.value
    if (debugRaw) {
      try {
        const debug = JSON.parse(debugRaw) as { role: string; facilityId: string; facilityName: string }
        // SECURITY: the __debug_role cookie is httpOnly:false (the client badge reads it),
        // so it is attacker-writable. Only honor it for the actual master admin — otherwise
        // any signed-in user could forge it to impersonate admin of any facility.
        if (debug.role && debug.facilityId && (await isMasterAdmin(userId))) {
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

    // P57 — deterministic: the fallback row below used to be whatever physical
    // order Postgres returned (no orderBy), so the master's "current facility"
    // could change between requests.
    const rows = await db.query.facilityUsers.findMany({
      where: eq(facilityUsers.userId, userId),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    })

    if (selected) {
      const match = rows.find((r) => r.facilityId === selected)
      if (match) return normalizeRole(match)

      // Bookkeepers have cross-facility access by role definition — selecting a
      // facility they hold no explicit membership row for resolves to a synthetic
      // bookkeeper row, as long as that facility exists and is active.
      const bookkeeperRow = rows.find((r) => r.role === 'bookkeeper')
      if (bookkeeperRow) {
        const fac = await db.query.facilities.findFirst({
          where: and(eq(facilities.id, selected), eq(facilities.active, true)),
          columns: { id: true },
        })
        if (fac) return normalizeRole({ ...bookkeeperRow, facilityId: selected })
      }

      // P57 — the MASTER gets the same synthetic access to any active facility
      // the cookie points at (verified by email server-side, never the cookie).
      // Before this, a master with no membership row at the selected facility
      // fell through to rows[0] (an arbitrary OTHER facility) or null — which is
      // how a stylist "added to F240" landed at no facility at all, and why
      // /stylists and /stylists/directory bounced the owner. Master already
      // bypasses every role guard by email; this only makes SCOPING follow the
      // facility he actually selected.
      if (await isMasterAdmin(userId)) {
        const fac = await db.query.facilities.findFirst({
          where: and(eq(facilities.id, selected), eq(facilities.active, true)),
          columns: { id: true },
        })
        if (fac) {
          return normalizeRole({
            id: 'master',
            userId,
            facilityId: selected,
            role: 'admin',
            commissionPercent: null as number | null,
            createdAt: null as Date | null,
            updatedAt: null as Date | null,
          })
        }
      }
    }

    if (rows.length === 0) return null
    return normalizeRole(rows[0])
  } catch (err) {
    console.error('[getUserFacility] DB error:', err)
    return null
  }
})

/**
 * True when the current user is a FRANCHISE admin (raw `super_admin` role) — used
 * to gate the franchise-only UI (the /franchise dashboard + nav link). This reads
 * the RAW role, NOT the normalized one: `getUserFacility()` rewrites super_admin →
 * admin so all admin guards pass, which means it can't tell us "is this a franchise
 * owner". So we read the un-normalized role here (honoring the master-gated debug
 * cookie, exactly like getUserFacility). Master admin is detected separately.
 */
export async function isFranchiseAdmin(userId: string): Promise<boolean> {
  try {
    const cookieStore = await cookies()

    const debugRaw = cookieStore.get('__debug_role')?.value
    if (debugRaw) {
      try {
        const debug = JSON.parse(debugRaw) as { role: string; facilityId: string }
        if (debug.role && debug.facilityId && (await isMasterAdmin(userId))) {
          return debug.role === 'super_admin'
        }
      } catch { /* malformed cookie — fall through */ }
    }

    const selected = cookieStore.get('selected_facility_id')?.value
    // P57 — same ordering as getUserFacility above: without it `rows[0]` is
    // whatever Postgres returns first, so a multi-facility user with no valid
    // cookie could be a franchise admin to this helper and a plain admin to
    // getUserFacility (or the reverse) on different requests.
    const rows = await db.query.facilityUsers.findMany({
      where: eq(facilityUsers.userId, userId),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    })
    if (rows.length === 0) return false
    const row = (selected && rows.find((r) => r.facilityId === selected)) || rows[0]
    return row.role === 'super_admin'
  } catch (err) {
    console.error('[isFranchiseAdmin] error:', err)
    return false
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
