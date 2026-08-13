import { facilities } from '@/db/schema'
import { and, eq, sql, type SQL } from 'drizzle-orm'

/**
 * P53 — THE where-clause for resolving a facility from a family-typed /
 * QR-encoded facility code. Case-insensitive (QR apps and mail clients
 * lowercase URLs; codes are stored upper-case), active-only, demo-excluded —
 * the resolve-facility-code route's semantics, shared.
 *
 * Callers keep their own `columns:` selection; ALWAYS use the returned row's
 * canonical `facilityCode` (not the typed one) for anything persisted or
 * compared downstream (claims, magic links, requirePortalAuth).
 */
export function activeFacilityByCodeWhere(code: string): SQL {
  const normalized = code.trim().toUpperCase()
  return and(
    sql`UPPER(${facilities.facilityCode}) = ${normalized}`,
    eq(facilities.active, true),
    eq(facilities.isDemo, false),
  )!
}
