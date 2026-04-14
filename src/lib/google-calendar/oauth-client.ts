import { google } from 'googleapis'
import { formatCents } from '@/lib/utils'

export type BookingEventData = {
  id: string
  startTime: Date
  endTime: Date
  priceCents: number | null
  notes: string | null
  residentName: string
  stylistName: string
  serviceName: string
  servicePriceCents: number
  facilityId: string
  residentId: string
  stylistId: string
  serviceId: string
}

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/google-calendar/callback`
  )
}

export function getAuthUrl(stylistId: string): string {
  const oauth2Client = createOAuth2Client()
  const state = Buffer.from(stylistId).toString('base64')
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state,
  })
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string
  refreshToken: string
  calendarId: string
}> {
  const oauth2Client = createOAuth2Client()
  const { tokens } = await oauth2Client.getToken(code)
  if (!tokens.refresh_token) throw new Error('No refresh token returned — ensure prompt=consent was set')
  if (!tokens.access_token) throw new Error('No access token returned')

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    calendarId: 'primary',
  }
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const { token } = await oauth2Client.getAccessToken()
  if (!token) throw new Error('Failed to get access token')
  return token
}

function buildEventBody(booking: BookingEventData) {
  return {
    summary: `${booking.residentName} — ${booking.serviceName}`,
    description: [
      `Stylist: ${booking.stylistName}`,
      `Service: ${booking.serviceName}`,
      `Price: ${formatCents(booking.priceCents ?? booking.servicePriceCents)}`,
      booking.notes ? `Notes: ${booking.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    start: { dateTime: new Date(booking.startTime).toISOString() },
    end: { dateTime: new Date(booking.endTime).toISOString() },
    extendedProperties: {
      private: {
        bookingId: booking.id,
        residentId: booking.residentId,
        stylistId: booking.stylistId,
        serviceId: booking.serviceId,
        facilityId: booking.facilityId,
      },
    },
  }
}

export async function createStylistCalendarEvent(
  refreshToken: string,
  calendarId: string,
  booking: BookingEventData
): Promise<string> {
  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
  const event = await calendar.events.insert({
    calendarId,
    requestBody: buildEventBody(booking),
  })
  return event.data.id!
}

export async function updateStylistCalendarEvent(
  refreshToken: string,
  calendarId: string,
  googleEventId: string,
  booking: BookingEventData
): Promise<void> {
  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
  await calendar.events.update({
    calendarId,
    eventId: googleEventId,
    requestBody: buildEventBody(booking),
  })
}

export async function deleteStylistCalendarEvent(
  refreshToken: string,
  calendarId: string,
  googleEventId: string
): Promise<void> {
  const oauth2Client = createOAuth2Client()
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
  try {
    await calendar.events.delete({ calendarId, eventId: googleEventId })
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 404) return
    throw err
  }
}
