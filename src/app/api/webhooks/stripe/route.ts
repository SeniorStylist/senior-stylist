import { db } from '@/db'
import { bookings, qbInvoices, qbPayments, qbUnappliedCredits, residents } from '@/db/schema'
import { and, asc, eq, gt, like, sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'
import { sendEmail, buildBookingReceiptHtml } from '@/lib/email'
import { sendSms, buildReceiptSms } from '@/lib/sms'
import { recomputeFacilityBalances } from '@/lib/unapplied-apply'

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

    // Payments (COF) backstop — persist a saved card if the client-side POST to
    // /api/payments/methods didn't land. Idempotent via the unique pm index.
    if (event.type === 'setup_intent.succeeded') {
      const si = event.data.object
      const md = si.metadata ?? {}
      if (md.residentId && md.facilityId) {
        try {
          const { saveCardFromSetupIntent } = await import('@/lib/payments/methods')
          await saveCardFromSetupIntent(si.id, {
            residentId: md.residentId,
            facilityId: md.facilityId,
            createdBy: md.createdBy || null,
          })
        } catch (e) {
          console.error('[stripe webhook setup_intent] persist failed:', e)
        }
      }
      return Response.json({ received: true })
    }

    // Payments (COF) backstop — finalize an in-app card collection if the client
    // confirm POST didn't land. Only in-app PIs (metadata.inApp='1'); the engine's
    // off-session charges record synchronously and are skipped. Idempotent.
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object
      if (pi.metadata?.inApp === '1') {
        try {
          const { finalizeInAppPayment } = await import('@/lib/payments/finalize')
          await finalizeInAppPayment(pi.id)
        } catch (e) {
          console.error('[stripe webhook payment_intent] finalize failed:', e)
        }
      }
      return Response.json({ received: true })
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const metadataType = session.metadata?.type

      if (metadataType === 'portal_balance') {
        await handlePortalBalance(session)
      } else if (metadataType === 'portal_prepay') {
        await handlePortalCredit(session, 'Prepayment')
      } else if (metadataType === 'portal_gift') {
        await handlePortalCredit(session, 'Gift')
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

  // Ensures the stripe_payment_intent_id column + unique index exist (no-op after first call).
  const { ensurePaymentsSchema } = await import('@/lib/payments-ddl')
  await ensurePaymentsSchema()
  // qb_unapplied_credits (overpayment banking below) — module-guarded no-op after first call.
  const { ensureUnappliedSchema } = await import('@/lib/unapplied-ddl')
  await ensureUnappliedSchema()

  await db.transaction(async (tx) => {
    // Stripe delivers checkout.session.completed at-least-once — stamp the PI on
    // the payment row and let the unique index reject a duplicate delivery so the
    // payment is never double-recorded / invoices never over-applied.
    const inserted = await tx
      .insert(qbPayments)
      .values({
        facilityId,
        residentId,
        amountCents,
        paymentMethod: 'stripe',
        paymentDate: new Date().toISOString().slice(0, 10),
        memo: `Online payment via portal — ${residentName}`,
        recordedVia: 'portal_stripe',
        stripePaymentIntentId,
      })
      .onConflictDoNothing()
      .returning({ id: qbPayments.id })
    if (inserted.length === 0) return // duplicate webhook delivery

    const openInvoices = await tx
      .select({
        id: qbInvoices.id,
        openBalanceCents: qbInvoices.openBalanceCents,
      })
      .from(qbInvoices)
      // P53 — is_demo filter: a facility carrying seed/demo invoices had REAL
      // family money retiring demo rows while the real invoice stayed open.
      .where(and(eq(qbInvoices.residentId, residentId), gt(qbInvoices.openBalanceCents, 0), eq(qbInvoices.isDemo, false)))
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

    // Safeguard (2026-07-07): never orphan money. If the payment exceeded the open
    // balance (double-pay race, stale amount), bank the remainder as an account
    // credit so it's visible and applies to future invoices instead of vanishing.
    if (remaining > 0) {
      const residentRow = await tx.query.residents.findFirst({
        where: eq(residents.id, residentId),
        columns: { qbCustomerId: true },
      })
      await tx.insert(qbUnappliedCredits).values({
        facilityId,
        residentId,
        qbCustomerId: residentRow?.qbCustomerId ?? `RES-${residentId.slice(0, 8)}`,
        txnType: 'Prepayment',
        txnDate: now.toISOString().slice(0, 10),
        num: `Portal overpayment · ${stripePaymentIntentId ?? session.id}`,
        amountCents: remaining,
        openBalanceCents: remaining,
        appliedCents: 0,
      })
    }

    // P53 — shared recompute: the old inline subquery skipped the is_demo
    // filter AND never touched facilities.qb_outstanding_balance_cents, so
    // facility A/R silently overstated by the sum of all portal payments.
    await recomputeFacilityBalances(tx, [facilityId])
  })

  revalidateTag('billing', {})
  revalidateTag('bookings', {})
}

// Prepayment / gift → bank an unapplied account credit on the TARGET resident
// (no auto-apply). A bookkeeper/admin attributes it to invoices manually from the
// resident ledger. For gifts, the target resident is the recipient; the gifter's
// name (if provided) is recorded in the credit memo/num.
async function handlePortalCredit(session: StripeCheckoutSession, source: 'Prepayment' | 'Gift'): Promise<void> {
  const md = session.metadata ?? {}
  const residentId = md.residentId
  const facilityId = md.facilityId
  const amountCents = session.amount_total ?? 0
  const stripePaymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null

  if (!residentId || !facilityId || amountCents <= 0) {
    console.error('[stripe webhook portal credit] missing metadata or zero amount', { md, amountCents, source })
    return
  }

  // Idempotency (P53): insert-first against the stripe_payment_intent_id
  // partial unique index inside createAccountCredit — the old read-then-write
  // LIKE scan could bank the same credit twice under Stripe's at-least-once
  // delivery. The LIKE scan is kept ONLY as a fast-path for legacy rows banked
  // before the column existed (their PI lives embedded in `num`).
  if (stripePaymentIntentId) {
    const { ensureUnappliedSchema } = await import('@/lib/unapplied-ddl')
    await ensureUnappliedSchema()
    const dup = await db.query.qbUnappliedCredits.findFirst({
      where: and(
        eq(qbUnappliedCredits.facilityId, facilityId),
        like(qbUnappliedCredits.num, `%${stripePaymentIntentId}%`),
      ),
      columns: { id: true },
    })
    if (dup) return
  }

  const { createAccountCredit } = await import('@/lib/account-credits')
  const numParts = [source === 'Gift' && md.gifterName ? `Gift from ${md.gifterName}` : null, stripePaymentIntentId]
    .filter(Boolean)
  const creditId = await createAccountCredit({
    facilityId,
    residentId,
    amountCents,
    source,
    num: numParts.join(' · ') || null,
    stripePaymentIntentId,
  })
  if (!creditId) return // duplicate delivery — already banked

  revalidateTag('billing', {})
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
        facility: { columns: { name: true, address: true, phone: true, timezone: true } },
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
      // Facility tz, not server tz — the lambda runs in UTC and an evening booking
      // would otherwise print the next day's date on the receipt.
      serviceDate: new Date(b.startTime).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: b.facility.timezone ?? 'America/New_York',
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
