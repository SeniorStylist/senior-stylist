import { db } from '@/db'
import {
  stylists,
  stylistAvailability,
  stylistFacilityAssignments,
  coverageRequests,
  bookings,
} from '@/db/schema'
import { and, eq, inArray, gte, lte, lt, gt, ne, isNotNull } from 'drizzle-orm'

export interface AvailableStylist {
  id: string
  name: string
}

function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function dateStr(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`
}

/**
 * Returns the stylists in the facility who are available for the given slot.
 * A stylist is available iff:
 *   1. active AND assigned to this facility
 *   2. has a stylist_availability row (dayOfWeek matches) with active=true and startTime<=slot<=endTime
 *   3. is not shadowed by a covered coverage_request on that date UNLESS they are the substitute
 *   4. has no overlapping booking (status != cancelled)
 */
export async function resolveAvailableStylists(opts: {
  facilityId: string
  startTime: Date
  endTime: Date
}): Promise<AvailableStylist[]> {
  const { facilityId, startTime, endTime } = opts
  const dow = startTime.getUTCDay()
  const startHM = hhmm(startTime)
  const endHM = hhmm(endTime)
  const date = dateStr(startTime)

  const facStylists = await db
    .select({ id: stylists.id, name: stylists.name })
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

  if (!facStylists.length) return []
  const stylistIds = facStylists.map((s) => s.id)

  const availRows = await db
    .select({ stylistId: stylistAvailability.stylistId })
    .from(stylistAvailability)
    .where(
      and(
        inArray(stylistAvailability.stylistId, stylistIds),
        eq(stylistAvailability.facilityId, facilityId),
        eq(stylistAvailability.dayOfWeek, dow),
        eq(stylistAvailability.active, true),
        lte(stylistAvailability.startTime, startHM),
        gte(stylistAvailability.endTime, endHM),
      ),
    )
  const availableSet = new Set(availRows.map((r) => r.stylistId))
  if (availableSet.size === 0) return []

  // Coverage: open/filled requests whose range contains date
  const cover = await db
    .select({
      stylistId: coverageRequests.stylistId,
      substituteStylistId: coverageRequests.substituteStylistId,
    })
    .from(coverageRequests)
    .where(
      and(
        eq(coverageRequests.facilityId, facilityId),
        inArray(coverageRequests.status, ['open', 'filled']),
        lte(coverageRequests.startDate, date),
        gte(coverageRequests.endDate, date),
      ),
    )
  const shadowed = new Set<string>()
  const covering = new Set<string>()
  for (const c of cover) {
    shadowed.add(c.stylistId)
    if (c.substituteStylistId) covering.add(c.substituteStylistId)
  }

  // Overlapping bookings
  const clashes = await db
    .select({ stylistId: bookings.stylistId })
    .from(bookings)
    .where(
      and(
        eq(bookings.facilityId, facilityId),
        ne(bookings.status, 'cancelled'),
        lt(bookings.startTime, endTime),
        gt(bookings.endTime, startTime),
        isNotNull(bookings.stylistId),
      ),
    )
  const busy = new Set(clashes.map((c) => c.stylistId))

  return facStylists.filter((s) => {
    if (!availableSet.has(s.id)) return false
    if (shadowed.has(s.id) && !covering.has(s.id)) return false
    if (busy.has(s.id)) return false
    return true
  })
}

/**
 * Picks the stylist with the fewest non-cancelled bookings on the slot's date.
 */
export async function pickStylistWithLeastLoad(
  candidates: AvailableStylist[],
  opts: { facilityId: string; date: Date },
): Promise<AvailableStylist | null> {
  if (!candidates.length) return null
  if (candidates.length === 1) return candidates[0]

  const { facilityId, date } = opts
  const dayStart = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0),
  )
  const dayEnd = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  )

  const dayBookings = await db
    .select({ stylistId: bookings.stylistId })
    .from(bookings)
    .where(
      and(
        eq(bookings.facilityId, facilityId),
        ne(bookings.status, 'cancelled'),
        gte(bookings.startTime, dayStart),
        lte(bookings.startTime, dayEnd),
        inArray(
          bookings.stylistId,
          candidates.map((c) => c.id),
        ),
      ),
    )

  const counts = new Map<string, number>()
  for (const c of candidates) counts.set(c.id, 0)
  for (const b of dayBookings) counts.set(b.stylistId, (counts.get(b.stylistId) ?? 0) + 1)

  let best = candidates[0]
  let bestCount = counts.get(best.id) ?? 0
  for (const c of candidates.slice(1)) {
    const ct = counts.get(c.id) ?? 0
    if (ct < bestCount) {
      best = c
      bestCount = ct
    }
  }
  return best
}
