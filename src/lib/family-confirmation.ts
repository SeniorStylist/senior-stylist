// P50 — "you're scheduled" email to the family, fired when a request becomes
// a real appointment (signup-sheet convert, or a legacy 'requested' booking
// flipped to 'scheduled'). Fire-and-forget at every call site — a mail
// failure must never fail the scheduling write.

import { db } from '@/db'
import { bookings, facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { sendEmail, buildBookingConfirmationEmailHtml } from '@/lib/email'
import { sendSms, buildBookingConfirmationSms } from '@/lib/sms'
import { getFamilyRecipients } from '@/lib/portal-recipients'
import { formatDateInTz, formatTimeInTz } from '@/lib/time'
import { formatMoney } from '@/lib/format'

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
    // Staff-side master switch gates everything; the family's per-channel
    // prefs (email_reminders / sms_reminders) gate each channel below — P55
    // sends BOTH channels when both contacts exist and both prefs are on.
    if (!recipients || !recipients.poaNotificationsEnabled) return
    const sendEmails = recipients.emails.length > 0 && recipients.emailReminders
    const sendTexts = recipients.phones.length > 0 && recipients.smsReminders
    if (!sendEmails && !sendTexts) return

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, booking.facilityId),
      columns: { name: true, timezone: true, facilityCode: true },
    })
    const tz = facility?.timezone ?? 'America/New_York'
    const portalUrl = facility?.facilityCode
      ? `https://portal.seniorstylist.com/family/${encodeURIComponent(facility.facilityCode)}`
      : 'https://portal.seniorstylist.com'

    const priceCents = booking.priceCents ?? booking.service?.priceCents ?? 0
    const residentName = booking.resident?.name ?? recipients.residentName
    const serviceName = booking.service?.name ?? booking.rawServiceName ?? 'Salon visit'
    const stylistName = booking.stylist?.name ?? 'Your stylist'
    const dateStr = formatDateInTz(booking.startTime, tz, { weekday: 'long', month: 'long', day: 'numeric' })
    const timeStr = formatTimeInTz(booking.startTime, tz)
    const facilityName = facility?.name ?? 'Senior Stylist'

    if (sendEmails) {
      const html = buildBookingConfirmationEmailHtml({
        residentName,
        serviceName,
        stylistName,
        dateStr,
        timeStr,
        priceStr: formatMoney(priceCents),
        facilityName,
        portalUrl,
        bookedBy: 'request',
      })
      await Promise.all(
        recipients.emails.map((to) =>
          sendEmail({
            to,
            subject: `Appointment scheduled — ${residentName}`,
            html,
          }).catch((err) => {
            console.error('[family-confirmation] send failed:', err)
            return false
          }),
        ),
      )
    }

    // P55 — SMS mirror (dormant no-op until TWILIO_ENABLED='true').
    if (sendTexts) {
      const smsBody = buildBookingConfirmationSms({ residentName, serviceName, stylistName, dateStr, timeStr, facilityName })
      for (const phone of recipients.phones) {
        sendSms(phone, smsBody).catch(() => {})
      }
    }
  } catch (err) {
    console.error('[family-confirmation] failed:', err)
  }
}
