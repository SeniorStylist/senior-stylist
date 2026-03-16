import { db } from '@/db'
import { bookings, residents, stylists, services } from '@/db/schema'
import { eq, and, gte, lte, or, lt, gt } from 'drizzle-orm'

export async function getBookingsByFacility(
  facilityId: string,
  startTime?: Date,
  endTime?: Date
) {
  const conditions = [eq(bookings.facilityId, facilityId)]
  if (startTime) conditions.push(gte(bookings.startTime, startTime))
  if (endTime) conditions.push(lte(bookings.endTime, endTime))

  return db.query.bookings.findMany({
    where: and(...conditions),
    with: {
      resident: true,
      stylist: true,
      service: true,
    },
    orderBy: (t, { asc }) => [asc(t.startTime)],
  })
}

export async function getBookingById(id: string) {
  return db.query.bookings.findFirst({
    where: eq(bookings.id, id),
    with: {
      resident: true,
      stylist: true,
      service: true,
    },
  })
}

export async function checkStylistConflict(
  stylistId: string,
  startTime: Date,
  endTime: Date,
  excludeBookingId?: string
) {
  // Find any booking for this stylist that overlaps with the given time window
  const existing = await db.query.bookings.findFirst({
    where: and(
      eq(bookings.stylistId, stylistId),
      or(
        // New booking starts during existing booking
        and(gte(bookings.startTime, startTime), lt(bookings.startTime, endTime)),
        // New booking ends during existing booking
        and(gt(bookings.endTime, startTime), lte(bookings.endTime, endTime)),
        // New booking completely contains existing booking
        and(lte(bookings.startTime, startTime), gte(bookings.endTime, endTime))
      ),
      // Exclude cancelled/no-show bookings from conflict check
      or(eq(bookings.status, 'scheduled'), eq(bookings.status, 'completed'))
    ),
  })

  if (!existing) return null
  if (excludeBookingId && existing.id === excludeBookingId) return null
  return existing
}
