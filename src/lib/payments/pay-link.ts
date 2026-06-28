// Failover pay-link: email/SMS the payor a secure link to pay the resident's
// balance. Called manually (request-payment route) and automatically when a COF
// collection fails (on-completion hook + nightly sweep). The link is a portal
// magic-link (when a POA email exists) or the portal login page (phone-only).

import { db } from '@/db'
import { facilities, residents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { createMagicLink } from '@/lib/portal-auth'
import { sendEmail, buildPaymentRequestEmailHtml } from '@/lib/email'
import { sendSms, buildPaymentRequestSms } from '@/lib/sms'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://portal.seniorstylist.com').replace(/\/$/, '')

export interface PayLinkResult {
  sent: boolean
  emailSent: boolean
  smsSent: boolean
  outstandingCents: number
  reason?: string
}

/**
 * Send the failover pay-link for a resident. `amountCents` overrides the resident's
 * stored outstanding balance (e.g. the exact uncollected amount). Email is awaited
 * (delivery matters); SMS is fire-and-forget per the project convention.
 */
export async function sendPaymentRequest(opts: {
  residentId: string
  amountCents?: number
  reason?: string | null
}): Promise<PayLinkResult> {
  const resident = await db.query.residents.findFirst({
    where: eq(residents.id, opts.residentId),
    columns: {
      id: true,
      name: true,
      facilityId: true,
      poaName: true,
      poaEmail: true,
      poaPhone: true,
      qbOutstandingBalanceCents: true,
    },
  })
  if (!resident) return { sent: false, emailSent: false, smsSent: false, outstandingCents: 0, reason: 'Resident not found' }

  const outstandingCents = opts.amountCents ?? resident.qbOutstandingBalanceCents ?? 0
  if (outstandingCents <= 0) {
    return { sent: false, emailSent: false, smsSent: false, outstandingCents, reason: 'No balance due' }
  }
  if (!resident.poaEmail && !resident.poaPhone) {
    return { sent: false, emailSent: false, smsSent: false, outstandingCents, reason: 'No payor contact on file' }
  }

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, resident.facilityId),
    columns: { name: true, facilityCode: true },
  })
  if (!facility?.facilityCode) {
    return { sent: false, emailSent: false, smsSent: false, outstandingCents, reason: 'Facility not portal-enabled' }
  }

  // Magic link requires a POA email (it is the portal identity). Phone-only payors
  // get the login page instead.
  const payUrl = resident.poaEmail
    ? await createMagicLink(resident.poaEmail, resident.id, facility.facilityCode)
    : `${APP_URL}/family/${encodeURIComponent(facility.facilityCode)}/login`

  let emailSent = false
  if (resident.poaEmail) {
    emailSent = await sendEmail({
      to: resident.poaEmail,
      subject: `Payment request — ${facility.name}`,
      html: buildPaymentRequestEmailHtml({
        residentName: resident.name,
        facilityName: facility.name,
        outstandingCents,
        payUrl,
        poaName: resident.poaName,
        reason: opts.reason ?? null,
      }),
    })
  }

  let smsSent = false
  if (resident.poaPhone && process.env.TWILIO_ENABLED === 'true') {
    void sendSms(
      resident.poaPhone,
      buildPaymentRequestSms({
        facilityName: facility.name,
        residentName: resident.name,
        outstandingCents,
        payUrl,
      }),
    )
    smsSent = true
  }

  return { sent: emailSent || smsSent, emailSent, smsSent, outstandingCents }
}
