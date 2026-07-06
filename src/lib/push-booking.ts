// W6: push the assigned stylist when their booking is rescheduled or cancelled.
// Loads everything it needs itself so route handlers can fire-and-forget it with
// just the booking id (mirrors the autoCollectOnCompletion hook pattern).
// Never throws; sendPushToUser is already best-effort on both rails (web + FCM).

import { db } from '@/db'
import { bookings, profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { sendPushToUser } from '@/lib/push'

export async function notifyBookingChange(
  bookingId: string,
  kind: 'rescheduled' | 'cancelled',
): Promise<void> {
  try {
    const b = await db.query.bookings.findFirst({
      where: eq(bookings.id, bookingId),
      columns: { id: true, stylistId: true, startTime: true, isDemo: true },
      with: {
        resident: { columns: { name: true } },
        facility: { columns: { timezone: true } },
      },
    })
    if (!b || b.isDemo) return

    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.stylistId, b.stylistId),
      columns: { id: true },
    })
    if (!profile) return // stylist has no login — nothing to push

    const tz = b.facility?.timezone ?? 'America/New_York'
    const when = new Date(b.startTime).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
    })
    const residentName = b.resident?.name ?? 'Appointment'

    await sendPushToUser(profile.id, {
      title: kind === 'cancelled' ? 'Appointment cancelled' : 'Appointment moved',
      body: kind === 'cancelled' ? `${residentName} — was ${when}` : `${residentName} — now ${when}`,
      url: '/dashboard',
    })
  } catch (err) {
    console.error('[notifyBookingChange] failed:', err)
  }
}
