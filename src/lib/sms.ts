/**
 * SMS sending (Twilio) — Phase 12E.
 *
 * Gated behind TWILIO_ENABLED='true'. Without that exact value, sendSms
 * is a logging no-op so receipt-send code paths can run safely in dev.
 *
 * Fire-and-forget contract: never throws. Failures log and return.
 */

import twilio from 'twilio'
import { formatMoney } from '@/lib/format'

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
    console.warn('[sms] disabled (TWILIO_ENABLED not "true") — would send to', to)
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
      ? ` + Tip ${formatMoney(data.tipCents)}`
      : ''
  const totalCents = (data.priceCents ?? 0) + (data.tipCents ?? 0)
  return (
    `Senior Stylist receipt: ${data.serviceName} with ${data.stylistName} on ${data.serviceDate}. ` +
    `Service ${formatMoney(data.priceCents)}${tipPart} = Total ${formatMoney(totalCents)}. ` +
    `Thank you! -${data.facilityName}`
  )
}

// P55 — phone-only signup welcome (no email = no magic link; the account works
// with phone + password, and the salon has their number for confirmations).
export function buildSignupWelcomeSms(data: { facilityName: string; residentName: string }): string {
  // P56 — the FIRST message a family ever receives carries the opt-out line
  // (A2P 10DLC convention; Twilio's account-level STOP handling does the rest).
  return (
    `${data.facilityName}: you're signed up for ${data.residentName}'s salon account. ` +
    `We'll text you about visits. Sign in any time with your phone number and password. ` +
    `Reply STOP to opt out.`
  )
}

// P55 — "you're scheduled" text, the SMS mirror of buildBookingConfirmationEmailHtml.
// Sent by family-confirmation.ts to every family phone when sms_reminders is on.
export function buildBookingConfirmationSms(data: {
  residentName: string
  serviceName: string
  stylistName: string
  dateStr: string
  timeStr: string
  facilityName: string
}): string {
  return (
    `Good news — ${data.residentName}'s ${data.serviceName} with ${data.stylistName} ` +
    `is set for ${data.dateStr} at ${data.timeStr}. -${data.facilityName}`
  )
}

// P55 — card-saved security notice for phone-only families (email version:
// buildCardAddedEmailHtml). Never pref-gated at the call site — it's a
// "wasn't you?" notice, not marketing.
export function buildCardAddedSms(data: { residentName: string; facilityName: string }): string {
  return (
    `A payment card was saved for ${data.residentName}'s salon account at ${data.facilityName}. ` +
    `If this wasn't you, call the salon.`
  )
}

// Payments (COF) — failover pay-link SMS. The link is a portal magic-link.
export function buildPaymentRequestSms(data: {
  facilityName: string
  residentName: string
  outstandingCents: number
  payUrl: string
}): string {
  return (
    `${data.facilityName}: a balance of ${formatMoney(data.outstandingCents)} is due for ${data.residentName}'s salon services. ` +
    `Pay securely here: ${data.payUrl}`
  )
}

// P57 — automatic-payment consent notice. The mirror of
// buildAutopayEnabledEmailHtml: it is the "wasn't you? call the salon" safety
// net that makes a staff-attested enable acceptable, so a phone-only family
// has to get it too.
export function buildAutopayChangedSms(data: {
  residentName: string
  facilityName: string
  cardLabel: string | null
  enabled: boolean
}): string {
  if (!data.enabled) {
    return (
      `${data.facilityName}: automatic payment was turned OFF for ${data.residentName}'s salon account. ` +
      `If this wasn't you, call the salon.`
    )
  }
  const card = data.cardLabel ? ` to ${data.cardLabel}` : ''
  return (
    `${data.facilityName}: automatic payment is now ON for ${data.residentName} — salon balances will be charged${card}, ` +
    `with a receipt each time. If this wasn't you, call the salon.`
  )
}

// P57 — receipt for a card-on-file charge. Distinct from buildReceiptSms,
// which is shaped around one booking ("<service> with <stylist>"): an autopay
// charge can cover a whole balance, so there is no single service or stylist to
// name and forcing one through that template read as nonsense ("Salon services
// with VISA ••4242").
export function buildAutoChargeReceiptSms(data: {
  facilityName: string
  residentName: string
  amountCents: number
  cardLabel: string | null
  dateLabel: string
}): string {
  const card = data.cardLabel ? ` to ${data.cardLabel}` : ''
  return (
    `${data.facilityName}: ${formatMoney(data.amountCents)} was charged${card} for ${data.residentName}'s ` +
    `salon services on ${data.dateLabel}. Questions? Call the salon. -Senior Stylist`
  )
}

// P57 — acknowledgement for a visit request submitted from the family portal.
// The request page previously only emailed, so a phone-only family (P55 made
// phone a first-class portal identity) got silence after tapping Request.
export function buildRequestReceivedSms(data: {
  facilityName: string
  residentName: string
  serviceName: string
  whenLabel: string
}): string {
  return (
    `${data.facilityName}: we got your request for ${data.serviceName} for ${data.residentName} (${data.whenLabel}). ` +
    `The stylist will confirm the time. -Senior Stylist`
  )
}

// Phase 16 G13 — day-before appointment reminder to the resident's POA.
// Dormant until TWILIO_ENABLED + a from-number exist (sendSms no-ops).
export function buildAppointmentReminderSms(data: {
  residentName: string
  serviceName: string
  time: string
  facilityName: string
}): string {
  return (
    `Reminder: ${data.residentName} has a ${data.serviceName} appointment tomorrow at ${data.time} ` +
    `at ${data.facilityName}. Reply to the facility with any questions. -Senior Stylist`
  )
}
