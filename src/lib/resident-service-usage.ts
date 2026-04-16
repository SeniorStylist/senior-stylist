import { db } from '@/db'
import { bookings } from '@/db/schema'
import { and, count, eq, isNotNull, ne } from 'drizzle-orm'

/**
 * Returns a Map of residentId → most-used primary serviceId for that resident,
 * based on non-cancelled bookings at the given facility.
 */
export async function getMostUsedServiceIds(facilityId: string): Promise<Map<string, string>> {
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

  return new Map(Array.from(best.entries()).map(([k, v]) => [k, v.serviceId]))
}
