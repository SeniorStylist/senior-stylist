// Finalize an in-app (on-session) card collection after the Payment Element
// confirms. Idempotent: keyed on the qb_payments row carrying the PaymentIntent
// id, so the confirm POST and the payment_intent.succeeded webhook backstop can
// both call it without double-recording. Also persists the card when the stylist
// ticked "save card" (setup_future_usage attached it to the resident's customer).

import { db } from '@/db'
import { bookings, facilities, paymentMethods, qbInvoices, qbPayments, residents } from '@/db/schema'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { calculateRevShare } from '@/lib/rev-share'
import { ensurePaymentsSchema } from '@/lib/payments-ddl'
import { getPlatformStripe } from './stripe-client'

export async function finalizeInAppPayment(paymentIntentId: string): Promise<{ recorded: boolean }> {
  await ensurePaymentsSchema()

  // Idempotency — already recorded?
  const existing = await db.query.qbPayments.findFirst({
    where: eq(qbPayments.stripePaymentIntentId, paymentIntentId),
    columns: { id: true },
  })
  if (existing) return { recorded: false }

  const stripe = await getPlatformStripe()
  if (!stripe) throw new Error('Stripe platform account not configured')

  const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
  if (pi.status !== 'succeeded') return { recorded: false }

  const md = pi.metadata ?? {}
  const residentId = md.residentId
  const facilityId = md.facilityId
  if (!residentId || !facilityId) {
    console.error('[finalizeInAppPayment] missing metadata', { paymentIntentId, md })
    return { recorded: false }
  }
  const amountCents = pi.amount_received || pi.amount
  const bookingIds = (md.bookingIds || '').split(',').filter(Boolean)
  const invoiceIds = (md.invoiceIds || '').split(',').filter(Boolean)

  const [resident, facility] = await Promise.all([
    db.query.residents.findFirst({ where: eq(residents.id, residentId), columns: { name: true, qbCustomerId: true } }),
    db.query.facilities.findFirst({ where: eq(facilities.id, facilityId), columns: { revSharePercentage: true, qbRevShareType: true } }),
  ])
  const split = calculateRevShare(amountCents, facility?.revSharePercentage ?? null, facility?.qbRevShareType ?? null)

  let recorded = false
  await db.transaction(async (tx) => {
    // Insert-first with conflict detection (unique index on stripe_payment_intent_id):
    // the confirm POST and the webhook backstop can interleave past the SELECT guard
    // above — only the path that wins the insert may apply invoices/bookings.
    const inserted = await tx
      .insert(qbPayments)
      .values({
        facilityId,
        residentId,
        qbCustomerId: resident?.qbCustomerId ?? null,
        amountCents,
        paymentMethod: 'card',
        paymentDate: new Date().toISOString().slice(0, 10),
        memo: `Card payment — ${resident?.name ?? 'resident'}`,
        recordedVia: 'stylist_collect',
        stripePaymentIntentId: paymentIntentId,
        collectedBy: md.collectedBy || null,
        revShareAmountCents: split.facilityShareCents,
        revShareType: split.revShareType,
        seniorStylistAmountCents: split.seniorStylistCents,
      })
      .onConflictDoNothing()
      .returning({ id: qbPayments.id })
    if (inserted.length === 0) return // another path already recorded this PI
    recorded = true

    // FIFO-apply to open invoices (specific invoiceIds first, else any open).
    const where = invoiceIds.length
      ? and(eq(qbInvoices.residentId, residentId), inArray(qbInvoices.id, invoiceIds), gt(qbInvoices.openBalanceCents, 0))
      : and(eq(qbInvoices.residentId, residentId), gt(qbInvoices.openBalanceCents, 0))
    const open = await tx
      .select({ id: qbInvoices.id, openBalanceCents: qbInvoices.openBalanceCents })
      .from(qbInvoices)
      .where(where)
      .orderBy(asc(qbInvoices.invoiceDate), asc(qbInvoices.createdAt))
    let remaining = amountCents
    const now = new Date()
    for (const inv of open) {
      if (remaining <= 0) break
      const take = Math.min(remaining, inv.openBalanceCents)
      const newOpen = inv.openBalanceCents - take
      await tx
        .update(qbInvoices)
        .set({
          openBalanceCents: newOpen,
          status: newOpen === 0 ? 'paid' : 'partial',
          ...(newOpen === 0 ? { stripePaymentIntentId: paymentIntentId, stripePaidAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(qbInvoices.id, inv.id))
      remaining -= take
    }

    if (bookingIds.length) {
      await tx
        .update(bookings)
        .set({ paymentStatus: 'paid', paymentMethod: 'Card', autopayAttemptedAt: now, autopayLastError: null, updatedAt: now })
        .where(and(inArray(bookings.id, bookingIds), eq(bookings.active, true)))
    }

    await tx.execute(sql`
      UPDATE residents r SET qb_outstanding_balance_cents = COALESCE((
        SELECT SUM(open_balance_cents) FROM qb_invoices WHERE resident_id = r.id AND is_demo = false
      ), 0) WHERE r.facility_id = ${facilityId}
    `)
    await tx.execute(sql`
      UPDATE facilities f SET qb_outstanding_balance_cents = COALESCE((
        SELECT SUM(open_balance_cents) FROM qb_invoices WHERE facility_id = f.id AND is_demo = false
      ), 0) WHERE f.id = ${facilityId}
    `)
  })
  if (!recorded) return { recorded: false }

  // Persist the card if it was saved (setup_future_usage attached it to the customer).
  if (md.savePaymentMethod === '1' && typeof pi.payment_method === 'string' && typeof pi.customer === 'string') {
    try {
      const pm = await stripe.paymentMethods.retrieve(pi.payment_method)
      const existingActive = await db
        .select({ id: paymentMethods.id })
        .from(paymentMethods)
        .where(and(eq(paymentMethods.residentId, residentId), eq(paymentMethods.active, true)))
      await db
        .insert(paymentMethods)
        .values({
          residentId,
          facilityId,
          stripeCustomerId: pi.customer,
          stripePaymentMethodId: pm.id,
          brand: pm.card?.brand ?? null,
          last4: pm.card?.last4 ?? null,
          expMonth: pm.card?.exp_month ?? null,
          expYear: pm.card?.exp_year ?? null,
          isDefault: existingActive.length === 0,
          createdBy: md.collectedBy || null,
        })
        .onConflictDoNothing({ target: paymentMethods.stripePaymentMethodId })
    } catch (e) {
      console.error('[finalizeInAppPayment] save card failed (payment still recorded):', e)
    }
  }

  revalidateTag('billing', {})
  revalidateTag('bookings', {})
  return { recorded: true }
}
