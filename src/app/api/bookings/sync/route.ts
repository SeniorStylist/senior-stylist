import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities } from '@/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { isCalendarConfigured } from '@/lib/google-calendar/client'
import { createCalendarEvent } from '@/lib/google-calendar/sync'

export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await db.query.facilityUsers.findFirst({
      where: (t, { eq }) => eq(t.userId, user.id),
    })
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    if (!isCalendarConfigured()) {
      return Response.json(
        { error: 'Google Calendar is not configured' },
        { status: 400 }
      )
    }

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
    })
    if (!facility?.calendarId) {
      return Response.json(
        { error: 'No calendar ID set for this facility' },
        { status: 400 }
      )
    }

    // Find all scheduled bookings without a googleEventId
    const unsynced = await db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.status, 'scheduled'),
        isNull(bookings.googleEventId)
      ),
      with: {
        resident: true,
        stylist: true,
        service: true,
      },
    })

    let synced = 0
    let failed = 0

    for (const booking of unsynced) {
      try {
        // historical_import bookings have no service — never sync to GCal
        if (!booking.service) continue
        const googleEventId = await createCalendarEvent(
          facility.calendarId,
          booking,
          booking.resident,
          booking.stylist,
          booking.service
        )

        await db
          .update(bookings)
          .set({ googleEventId, syncError: null, updatedAt: new Date() })
          .where(eq(bookings.id, booking.id))

        synced++
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        await db
          .update(bookings)
          .set({ syncError: errorMessage, updatedAt: new Date() })
          .where(eq(bookings.id, booking.id))
        failed++
      }
    }

    return Response.json({ data: { total: unsynced.length, synced, failed } })
  } catch (err) {
    console.error('POST /api/bookings/sync error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
