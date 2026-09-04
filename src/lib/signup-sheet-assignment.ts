import { db as defaultDb } from '@/db'
import { bookings, stylistAvailability, stylistFacilityAssignments, stylists } from '@/db/schema'
import { and, count, desc, eq, gte, inArray, lte, ne, or } from 'drizzle-orm'

type Db = typeof defaultDb

/**
 * Resolves the best stylist to auto-assign to a signup-sheet entry.
 *
 * Priority:
 *  0. P50 — opts.preferredStylistId (the family's chosen stylist from
 *     resident_preferences): validated active + status='active' + an active
 *     assignment at this facility. If valid, they win outright.
 *  1. preferredDate present → facility stylists with stylist_availability for that
 *     day-of-week (active=true). If multiple, pick the least-loaded (fewest
 *     non-cancelled bookings on that date). If exactly one, return them.
 *  2. Fallback (no preferredDate OR no day-of-week match) → assign ONLY when the
 *     facility has EXACTLY ONE active assigned stylist. Two or more → null.
 *  3. No candidates → null.
 *
 * P60 — the fallback used to pick the most-recently-updated stylist. At a
 * facility with several stylists and no availability rows yet (exactly a
 * newly-created facility), that stamped the request onto ONE arbitrary stylist,
 * where it disappeared from every OTHER stylist's queue (which shows own +
 * unassigned only). Unassigned is the safe state: everyone can see it and claim
 * it. Only a single-stylist facility has an unambiguous owner to assign.
 *
 * P55 — opts.demoOnly (default false) mirrors resolveAvailableStylists: EVERY
 * branch filters eq(stylists.isDemo, demoOnly). Without it, seeded "Demo Sarah"
 * (active + Mon–Fri availability + fresh updatedAt) won BOTH the day-of-week
 * and fallback paths for REAL entries — which then became invisible to every
 * real stylist (the queue's own+unassigned filter). Real callers pass false
 * (or isTutorialRequest); tutorial entries pass true so tours keep Demo Sarah.
 */
export async function resolveAssignedStylist(
  facilityId: string,
  preferredDate: string | null,
  dbInstance: Db = defaultDb,
  opts?: { preferredStylistId?: string | null; demoOnly?: boolean },
): Promise<string | null> {
  const demoOnly = opts?.demoOnly ?? false
  if (opts?.preferredStylistId) {
    const preferred = await dbInstance
      .select({ stylistId: stylists.id })
      .from(stylists)
      .innerJoin(
        stylistFacilityAssignments,
        and(
          eq(stylistFacilityAssignments.stylistId, stylists.id),
          eq(stylistFacilityAssignments.facilityId, facilityId),
          eq(stylistFacilityAssignments.active, true),
        ),
      )
      .where(
        and(
          eq(stylists.id, opts.preferredStylistId),
          eq(stylists.active, true),
          eq(stylists.status, 'active'),
          eq(stylists.isDemo, demoOnly),
        ),
      )
      .limit(1)
    if (preferred[0]) return preferred[0].stylistId
  }

  if (preferredDate) {
    const [y, m, d] = preferredDate.split('-').map(Number)
    if (!y || !m || !d) return resolveFallback(facilityId, dbInstance, demoOnly)
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()

    const candidates = await dbInstance
      .select({ stylistId: stylists.id })
      .from(stylists)
      .innerJoin(
        stylistFacilityAssignments,
        and(
          eq(stylistFacilityAssignments.stylistId, stylists.id),
          eq(stylistFacilityAssignments.facilityId, facilityId),
          eq(stylistFacilityAssignments.active, true),
        ),
      )
      .innerJoin(
        stylistAvailability,
        and(
          eq(stylistAvailability.stylistId, stylists.id),
          eq(stylistAvailability.facilityId, facilityId),
          eq(stylistAvailability.dayOfWeek, dow),
          eq(stylistAvailability.active, true),
        ),
      )
      .where(and(eq(stylists.active, true), eq(stylists.status, 'active'), eq(stylists.isDemo, demoOnly)))

    if (candidates.length === 1) return candidates[0].stylistId
    if (candidates.length > 1) {
      const ids = candidates.map((c) => c.stylistId)
      const dayStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
      const dayEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
      const loads = await dbInstance
        .select({ stylistId: bookings.stylistId, n: count() })
        .from(bookings)
        .where(
          and(
            eq(bookings.facilityId, facilityId),
            ne(bookings.status, 'cancelled'),
            inArray(bookings.stylistId, ids),
            gte(bookings.startTime, dayStart),
            lte(bookings.startTime, dayEnd),
          ),
        )
        .groupBy(bookings.stylistId)

      const loadMap = new Map<string, number>()
      for (const id of ids) loadMap.set(id, 0)
      for (const r of loads) if (r.stylistId) loadMap.set(r.stylistId, Number(r.n))
      return ids.sort((a, b) => (loadMap.get(a) ?? 0) - (loadMap.get(b) ?? 0))[0]
    }
  }

  return resolveFallback(facilityId, dbInstance, demoOnly)
}

/**
 * Unambiguous-owner fallback. Returns a stylist ONLY when the facility has
 * exactly one active stylist on its roster — home rows plus active assignment
 * rows, the same union every other roster surface reads (P33). With two or more
 * there is no basis to choose, and a wrong guess hides the request from
 * everyone else (see the P60 note above). LIMIT 2 tells "one" from "many".
 */
async function resolveFallback(facilityId: string, dbInstance: Db, demoOnly: boolean): Promise<string | null> {
  // P33 roster rule: home rows PLUS active assignment rows. An assignments-only
  // count undercounts the roster — stylists created before round 6 have a home
  // row and no assignment row — and the count is LOAD-BEARING here: it decides
  // assign-vs-null, not merely an order. Undercounting to one would stamp the
  // entry on that one stylist and hide it from the home-row stylist who is
  // actually working, which is the exact failure this fallback exists to stop.
  const assigned = await dbInstance
    .select({ id: stylistFacilityAssignments.stylistId })
    .from(stylistFacilityAssignments)
    .where(
      and(eq(stylistFacilityAssignments.facilityId, facilityId), eq(stylistFacilityAssignments.active, true)),
    )
  const assignedIds = assigned.map((r) => r.id)

  const candidates = await dbInstance
    .select({ stylistId: stylists.id })
    .from(stylists)
    .where(
      and(
        assignedIds.length
          ? or(eq(stylists.facilityId, facilityId), inArray(stylists.id, assignedIds))
          : eq(stylists.facilityId, facilityId),
        eq(stylists.active, true),
        eq(stylists.status, 'active'),
        // P55 — every branch filters isDemo: a real entry must never land on Demo Sarah.
        eq(stylists.isDemo, demoOnly),
      ),
    )
    .orderBy(desc(stylists.updatedAt))
    .limit(2)

  if (candidates.length !== 1) return null
  return candidates[0].stylistId
}
