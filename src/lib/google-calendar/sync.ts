import { getCalendarClient } from './client'
import { formatCents } from '@/lib/utils'

// Use loose types so Drizzle query results (which have status: string) are compatible
type BookingLike = {
  id: string
  facilityId: string
  residentId: string
  stylistId: string
  serviceId: string
  startTime: Date
  endTime: Date
  priceCents: number | null
  notes: string | null
}

type ResidentLike = { id: string; name: string }
type StylistLike = { id: string; name: string; color: string }
type ServiceLike = { id: string; name: string; priceCents: number }

export async function createCalendarEvent(
  calendarId: string,
  booking: BookingLike,
  resident: ResidentLike,
  stylist: StylistLike,
  service: ServiceLike
): Promise<string> {
  const calendar = getCalendarClient()

  const event = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `${resident.name} — ${service.name}`,
      description: [
        `Stylist: ${stylist.name}`,
        `Service: ${service.name}`,
        `Price: ${formatCents(booking.priceCents ?? service.priceCents)}`,
        booking.notes ? `Notes: ${booking.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      start: {
        dateTime: new Date(booking.startTime).toISOString(),
      },
      end: {
        dateTime: new Date(booking.endTime).toISOString(),
      },
      colorId: stylist.color ? undefined : undefined,
      extendedProperties: {
        private: {
          bookingId: booking.id,
          residentId: booking.residentId,
          stylistId: booking.stylistId,
          serviceId: booking.serviceId,
          facilityId: booking.facilityId,
        },
      },
    },
  })

  return event.data.id!
}

export async function updateCalendarEvent(
  calendarId: string,
  googleEventId: string,
  booking: BookingLike,
  resident: ResidentLike,
  stylist: StylistLike,
  service: ServiceLike
): Promise<void> {
  const calendar = getCalendarClient()

  await calendar.events.update({
    calendarId,
    eventId: googleEventId,
    requestBody: {
      summary: `${resident.name} — ${service.name}`,
      description: [
        `Stylist: ${stylist.name}`,
        `Service: ${service.name}`,
        `Price: ${formatCents(booking.priceCents ?? service.priceCents)}`,
        booking.notes ? `Notes: ${booking.notes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      start: {
        dateTime: new Date(booking.startTime).toISOString(),
      },
      end: {
        dateTime: new Date(booking.endTime).toISOString(),
      },
      extendedProperties: {
        private: {
          bookingId: booking.id,
          residentId: booking.residentId,
          stylistId: booking.stylistId,
          serviceId: booking.serviceId,
          facilityId: booking.facilityId,
        },
      },
    },
  })
}

export async function deleteCalendarEvent(
  calendarId: string,
  googleEventId: string
): Promise<void> {
  const calendar = getCalendarClient()
  try {
    await calendar.events.delete({
      calendarId,
      eventId: googleEventId,
    })
  } catch (err: unknown) {
    // Swallow 404 — event may already be gone
    if ((err as { code?: number }).code === 404) return
    throw err
  }
}

export async function listCalendarEvents(
  calendarId: string,
  startDate: Date,
  endDate: Date
) {
  const calendar = getCalendarClient()

  const response = await calendar.events.list({
    calendarId,
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  })

  return response.data.items ?? []
}
