import { db as defaultDb } from '@/db'
import { bookings, stylistAvailability, stylistFacilityAssignments, stylists } from '@/db/schema'
import { and, count, desc, eq, gte, inArray, lte, ne } from 'drizzle-orm'

type Db = typeof defaultDb

/**
 * Resolves the best stylist to auto-assign to a signup-sheet entry.
 *
 * Priority:
 *  1. preferredDate present → facility stylists with stylist_availability for that
 *     day-of-week (active=true). If multiple, pick the least-loaded (fewest
 *     non-cancelled bookings on that date). If exactly one, return them.
 *  2. Fallback (no preferredDate OR no day-of-week match) → most-recently-updated
 *     active stylist assigned to the facility.
 *  3. No candidates → null.
 */
export async function resolveAssignedStylist(
  facilityId: string,
  preferredDate: string | null,
  dbInstance: Db = defaultDb,
): Promise<string | null> {
  if (preferredDate) {
    const [y, m, d] = preferredDate.split('-').map(Number)
    if (!y || !m || !d) return resolveFallback(facilityId, dbInstance)
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
      .where(and(eq(stylists.active, true), eq(stylists.status, 'active')))

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

  return resolveFallback(facilityId, dbInstance)
}

async function resolveFallback(facilityId: string, dbInstance: Db): Promise<string | null> {
  const fallback = await dbInstance
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
    .where(and(eq(stylists.active, true), eq(stylists.status, 'active')))
    .orderBy(desc(stylists.updatedAt))
    .limit(1)

  return fallback[0]?.stylistId ?? null
}
