/**
 * SMS sending (Twilio) — Phase 12E.
 *
 * Gated behind TWILIO_ENABLED='true'. Without that exact value, sendSms
 * is a logging no-op so receipt-send code paths can run safely in dev.
 *
 * Fire-and-forget contract: never throws. Failures log and return.
 */

import twilio from 'twilio'

let cachedClient: ReturnType<typeof twilio> | null = null

function getClient(): ReturnType<typeof twilio> | null {
  if (cachedClient) return cachedClient
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  cachedClient = twilio(sid, token)
  return cachedClient
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (process.env.TWILIO_ENABLED !== 'true') {
    console.log('[sms] disabled (TWILIO_ENABLED not "true") — would send to', to)
    return
  }
  const from = process.env.TWILIO_FROM_NUMBER
  if (!from) {
    console.error('[sms] TWILIO_ENABLED=true but TWILIO_FROM_NUMBER is unset')
    return
  }
  const client = getClient()
  if (!client) {
    console.error('[sms] TWILIO_ENABLED=true but credentials missing')
    return
  }
  try {
    await client.messages.create({ to, from, body })
  } catch (err) {
    console.error('[sms] failed to send:', err)
  }
}

export function buildReceiptSms(data: {
  facilityName: string
  serviceName: string
  stylistName: string
  serviceDate: string
  priceCents: number
  tipCents: number | null
  paymentType?: string | null
}): string {
  const tipPart =
    data.tipCents != null && data.tipCents > 0
      ? ` + Tip $${(data.tipCents / 100).toFixed(2)}`
      : ''
  const totalCents = (data.priceCents ?? 0) + (data.tipCents ?? 0)
  return (
    `Senior Stylist receipt: ${data.serviceName} with ${data.stylistName} on ${data.serviceDate}. ` +
    `Service $${(data.priceCents / 100).toFixed(2)}${tipPart} = Total $${(totalCents / 100).toFixed(2)}. ` +
    `Thank you! -${data.facilityName}`
  )
}
