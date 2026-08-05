// P50 — "you're scheduled" email to the family, fired when a request becomes
// a real appointment (signup-sheet convert, or a legacy 'requested' booking
// flipped to 'scheduled'). Fire-and-forget at every call site — a mail
// failure must never fail the scheduling write.

import { db } from '@/db'
import { bookings, facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { sendEmail, buildBookingConfirmationEmailHtml } from '@/lib/email'
import { getFamilyRecipients } from '@/lib/portal-recipients'
import { formatDateInTz, formatTimeInTz } from '@/lib/time'

export async function sendFamilyBookingConfirmation(bookingId: string): Promise<void> {
  try {
    const booking = await db.query.bookings.findFirst({
      where: eq(bookings.id, bookingId),
      columns: { id: true, residentId: true, startTime: true, priceCents: true, facilityId: true, rawServiceName: true, isDemo: true },
      with: {
        resident: { columns: { name: true } },
        service: { columns: { name: true, priceCents: true } },
        stylist: { columns: { name: true } },
      },
    })
    if (!booking || booking.isDemo || !booking.residentId) return

    const recipients = await getFamilyRecipients(booking.residentId)
    // Honor BOTH gates: the staff-side master switch and the family's own
    // email-reminders checkbox (which finally has a reader — P50).
    if (!recipients || recipients.emails.length === 0) return
    if (!recipients.poaNotificationsEnabled || !recipients.emailReminders) return

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, booking.facilityId),
      columns: { name: true, timezone: true, facilityCode: true },
    })
    const tz = facility?.timezone ?? 'America/New_York'
    const portalUrl = facility?.facilityCode
      ? `https://portal.seniorstylist.com/family/${encodeURIComponent(facility.facilityCode)}`
      : 'https://portal.seniorstylist.com'

    const priceCents = booking.priceCents ?? booking.service?.priceCents ?? 0
    const html = buildBookingConfirmationEmailHtml({
      residentName: booking.resident?.name ?? recipients.residentName,
      serviceName: booking.service?.name ?? booking.rawServiceName ?? 'Salon visit',
      stylistName: booking.stylist?.name ?? 'Your stylist',
      dateStr: formatDateInTz(booking.startTime, tz, { weekday: 'long', month: 'long', day: 'numeric' }),
      timeStr: formatTimeInTz(booking.startTime, tz),
      priceStr: `$${(priceCents / 100).toFixed(2)}`,
      facilityName: facility?.name ?? 'Senior Stylist',
      portalUrl,
      bookedBy: 'request',
    })

    await Promise.all(
      recipients.emails.map((to) =>
        sendEmail({
          to,
          subject: `Appointment scheduled — ${booking.resident?.name ?? recipients.residentName}`,
          html,
        }).catch((err) => {
          console.error('[family-confirmation] send failed:', err)
          return false
        }),
      ),
    )
  } catch (err) {
    console.error('[family-confirmation] failed:', err)
  }
}
