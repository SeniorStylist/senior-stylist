// Phase 15 F4 — when a booking is cancelled, check whether any pending waitlist
// entry's date window covers the freed slot and notify facility admins (bell +
// push via notifyFacilityAdmins). Fire-and-forget from both cancel paths in
// /api/bookings/[id] — never throws.

import { db } from '@/db'
import { facilities, waitlistEntries } from '@/db/schema'
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { ensureWaitlistSchema } from '@/lib/waitlist-ddl'
import { notifyFacilityAdmins } from '@/lib/notify'
import { getLocalParts, formatTimeInTz } from '@/lib/time'

export async function matchWaitlistOnCancellation(booking: {
  facilityId: string
  startTime: Date | string
  isDemo?: boolean | null
}): Promise<void> {
  try {
    if (booking.isDemo) return
    await ensureWaitlistSchema()

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, booking.facilityId),
      columns: { timezone: true },
    })
    const tz = facility?.timezone ?? 'America/New_York'
    const start = new Date(booking.startTime)
    const p = getLocalParts(start, tz)
    const slotDate = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`

    // ONE query: pending entries whose window covers the freed slot's local date.
    const waiting = await db
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(and(
        eq(waitlistEntries.facilityId, booking.facilityId),
        eq(waitlistEntries.status, 'pending'),
        eq(waitlistEntries.isDemo, false),
        lte(waitlistEntries.earliestDate, slotDate),
        or(isNull(waitlistEntries.latestDate), gte(waitlistEntries.latestDate, slotDate)),
      ))
      .limit(50)
    if (waiting.length === 0) return

    const whenLabel = `${new Date(slotDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${formatTimeInTz(start, tz)}`
    await notifyFacilityAdmins(booking.facilityId, {
      type: 'waitlist_slot_opened',
      title: 'Slot opened — waitlist match',
      body: `${whenLabel} freed up — ${waiting.length} resident${waiting.length === 1 ? '' : 's'} waiting`,
      url: '/dashboard',
    })
  } catch (err) {
    console.error('[matchWaitlistOnCancellation] failed:', err)
  }
}
