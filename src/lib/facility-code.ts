import { facilities } from '@/db/schema'
import { and, eq, sql, type SQL } from 'drizzle-orm'
import type { db } from '@/db'

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** The one shape a facility code may take (F12 … F24000). */
export const FACILITY_CODE_RE = /^F\d{2,5}$/

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
export function activeFacilityByCodeWhere(code: string, opts?: { allowDemo?: boolean }): SQL {
  const normalized = code.trim().toUpperCase()
  return and(
    sql`UPPER(${facilities.facilityCode}) = ${normalized}`,
    eq(facilities.active, true),
    // APLEY — `allowDemo` is the ONLY way a demo facility's family portal can
    // resolve, and it is passed exclusively for a server-verified master
    // session (never from a query param or a client-supplied value). Without
    // it a demo facility has no family portal AT ALL — every one of this
    // helper's callers gates the portal — so the owner-facing end-to-end demo
    // could not exist. The public path is unchanged: for anyone who is not the
    // master, demo facilities stay invisible exactly as P53 intended.
    ...(opts?.allowDemo ? [] : [eq(facilities.isDemo, false)]),
  )!
}

/**
 * Next free F-code = (max F-number across ALL facilities, active or not) + 1.
 * We never reuse a gap left by an inactive facility — if a community returns,
 * its old code is still theirs and won't have been handed out to someone else.
 * (P60 — moved here from the multi-log importer's route file so the create
 * path and the importers share one generator.)
 */
export function nextFacilityCode(codes: (string | null)[]): string {
  let max = 0
  for (const c of codes) {
    const m = c?.match(/^F(\d+)$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `F${String(max + 1).padStart(3, '0')}`
}

/**
 * P60 — allocate the next facility code inside a transaction. Mirrors
 * generateStylistCode: an advisory lock (9192 — 9191 is the stylist lock)
 * serializes concurrent creates so two masters can't both be handed F241.
 * The partial unique index (drizzle/0047) is the backstop.
 */
export async function generateFacilityCode(tx: DrizzleTx): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(9192)`)
  const rows = await tx
    .select({ code: facilities.facilityCode })
    .from(facilities)
    .where(sql`${facilities.facilityCode} ~ '^F[0-9]+$'`)
  return nextFacilityCode(rows.map((r) => r.code))
}
