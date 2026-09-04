import { db } from '@/db'
import { bookings } from '@/db/schema'
import { and, count, eq, gte, isNotNull, ne } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'

// P31 — this GROUP BY scans every non-cancelled booking at the facility and
// used to run UNCACHED and sequentially after the page Promise.all on both
// hot pages (dashboard + day log). Cached 5 min under the 'bookings' tag
// (every booking mutation already busts it). The cached value is a JSON-plain
// pairs array — NEVER return a Map from unstable_cache (P26 rule: warm hits
// are JSON round-tripped, which silently turns a Map into {}).
const getCachedMostUsedPairs = unstable_cache(
  async (facilityId: string): Promise<[string, string][]> => {
    const rows = await db
      .select({
        residentId: bookings.residentId,
        serviceId: bookings.serviceId,
        cnt: count(),
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.facilityId, facilityId),
          ne(bookings.status, 'cancelled'),
          isNotNull(bookings.serviceId),
          // P63 — this was an unbounded scan of the facility's ENTIRE booking
          // history, and it is the single most data-sensitive query on the
          // dashboard: instant at a new community, and a full partition scan at
          // one fed by the bulk importers — which is exactly why the dashboard
          // failed at "some facilities but not others". A visit from 2019 has no
          // business voting on which service to preselect today.
          gte(bookings.startTime, new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)),
          // …and rolled-back imports (active = false) were being counted.
          eq(bookings.active, true),
        )
      )
      .groupBy(bookings.residentId, bookings.serviceId)

    const best = new Map<string, { serviceId: string; cnt: number }>()
    for (const row of rows) {
      if (!row.residentId || !row.serviceId) continue
      const existing = best.get(row.residentId)
      const cnt = Number(row.cnt)
      if (!existing || cnt > existing.cnt) {
        best.set(row.residentId, { serviceId: row.serviceId, cnt })
      }
    }
    return Array.from(best.entries()).map(([k, v]) => [k, v.serviceId])
  },
  ['most-used-service-ids-v1'],
  { revalidate: 300, tags: ['bookings'] },
)

/**
 * Returns a Map of residentId → most-used primary serviceId for that resident,
 * based on non-cancelled bookings at the given facility.
 */
export async function getMostUsedServiceIds(facilityId: string): Promise<Map<string, string>> {
  try {
    return new Map(await getCachedMostUsedPairs(facilityId))
  } catch {
    // Cache layer hiccup — usual-service preselect is a nicety, never a blocker.
    return new Map()
  }
}
