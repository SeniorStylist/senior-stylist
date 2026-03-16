import { google } from 'googleapis'

export function getCalendarClient() {
  const credentials = JSON.parse(
    Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_BASE64!, 'base64').toString()
  )

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })

  return google.calendar({ version: 'v3', auth })
}

export function isCalendarConfigured(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 &&
    process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 !== 'your-base64-encoded-json'
}
