import { db } from '@/db'
import { bookings, qbInvoices, qbPayments, residents } from '@/db/schema'
import { and, asc, eq, gt, sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'
import { sendEmail, buildBookingReceiptHtml } from '@/lib/email'
import { sendSms, buildReceiptSms } from '@/lib/sms'

export async function POST(request: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      return Response.json({ error: 'Stripe not configured' }, { status: 503 })
    }

    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      return Response.json({ error: 'Missing signature' }, { status: 400 })
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

    let event
    try {
      event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err)
      return Response.json({ error: 'Invalid signature' }, { status: 400 })
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const metadataType = session.metadata?.type

      if (metadataType === 'portal_balance') {
        await handlePortalBalance(session)
      } else {
        const bookingId = session.metadata?.bookingId
        if (bookingId) {
          await db
            .update(bookings)
            .set({ paymentStatus: 'paid', updatedAt: new Date() })
            .where(eq(bookings.id, bookingId))
          // Phase 12E — auto-send receipt after card payment.
          // Fire-and-forget: never block the webhook 200, never throw.
          void sendBookingReceipt(bookingId)
        }
      }
    }

    return Response.json({ received: true })
  } catch (err) {
    console.error('POST /api/webhooks/stripe error:', err)
    // Always 200 — Stripe retries non-2xx and we don't want infinite retries on transient blips.
    return Response.json({ received: true, error: 'Internal — logged' })
  }
}

type StripeCheckoutSession = {
  id: string
  amount_total: number | null
  payment_intent: string | null | unknown
  metadata: Record<string, string> | null
}

async function handlePortalBalance(session: StripeCheckoutSession): Promise<void> {
  const md = session.metadata ?? {}
  const residentId = md.residentId
  const facilityId = md.facilityId
  const residentName = md.residentName ?? 'resident'
  const amountCents = session.amount_total ?? 0
  const stripePaymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : null

  if (!residentId || !facilityId || amountCents <= 0) {
    console.error('[stripe webhook portal_balance] missing metadata or zero amount', { md, amountCents })
    return
  }

  await db.transaction(async (tx) => {
    await tx.insert(qbPayments).values({
      facilityId,
      residentId,
      amountCents,
      paymentMethod: 'stripe',
      paymentDate: new Date().toISOString().slice(0, 10),
      memo: `Online payment via portal — ${residentName}`,
      recordedVia: 'portal_stripe',
    })

    const openInvoices = await tx
      .select({
        id: qbInvoices.id,
        openBalanceCents: qbInvoices.openBalanceCents,
      })
      .from(qbInvoices)
      .where(and(eq(qbInvoices.residentId, residentId), gt(qbInvoices.openBalanceCents, 0)))
      .orderBy(asc(qbInvoices.invoiceDate), asc(qbInvoices.createdAt))

    let remaining = amountCents
    const now = new Date()
    for (const inv of openInvoices) {
      if (remaining <= 0) break
      const decrement = Math.min(remaining, inv.openBalanceCents)
      const newOpen = inv.openBalanceCents - decrement
      remaining -= decrement
      if (newOpen === 0) {
        await tx
          .update(qbInvoices)
          .set({
            openBalanceCents: 0,
            status: 'paid',
            stripePaymentIntentId,
            stripePaidAt: now,
            updatedAt: now,
          })
          .where(eq(qbInvoices.id, inv.id))
      } else {
        await tx
          .update(qbInvoices)
          .set({ openBalanceCents: newOpen, status: 'partial', updatedAt: now })
          .where(eq(qbInvoices.id, inv.id))
      }
    }

    await tx
      .update(residents)
      .set({
        qbOutstandingBalanceCents: sql`(SELECT COALESCE(SUM(open_balance_cents), 0) FROM qb_invoices WHERE resident_id = ${residentId} AND open_balance_cents > 0)`,
        updatedAt: now,
      })
      .where(eq(residents.id, residentId))
  })

  revalidateTag('billing', {})
  revalidateTag('bookings', {})
}

// Phase 12E — fire-and-forget booking receipt after Stripe card payment.
async function sendBookingReceipt(bookingId: string): Promise<void> {
  try {
    const b = await db.query.bookings.findFirst({
      where: eq(bookings.id, bookingId),
      with: {
        resident: { columns: { name: true, poaEmail: true, poaPhone: true } },
        stylist: { columns: { name: true } },
        service: { columns: { name: true } },
        facility: { columns: { name: true, address: true, phone: true } },
      },
    })
    if (!b) return
    const data = {
      facilityName: b.facility.name,
      facilityAddress: b.facility.address,
      facilityPhone: b.facility.phone,
      residentName: b.resident.name,
      serviceName: b.service?.name ?? b.rawServiceName ?? 'Service',
      stylistName: b.stylist.name,
      serviceDate: new Date(b.startTime).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
      priceCents: b.priceCents ?? 0,
      tipCents: b.tipCents,
      paymentType: 'Card',
    }
    if (b.resident.poaEmail) {
      void sendEmail({
        to: b.resident.poaEmail,
        subject: `Receipt — ${b.facility.name}`,
        html: buildBookingReceiptHtml(data),
      })
    }
    if (b.resident.poaPhone && process.env.TWILIO_ENABLED === 'true') {
      void sendSms(b.resident.poaPhone, buildReceiptSms(data))
    }
  } catch (err) {
    console.error('[stripe.receipt] failed:', err)
  }
}
