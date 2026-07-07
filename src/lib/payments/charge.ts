// Charge engine — the single entry point that actually COLLECTS money for a
// resident. Shared by every trigger: the manual "Collect now" button, the
// on-completion booking hook, the nightly autopay sweep, and the in-app stylist
// collection screen. Rail-agnostic on the backend — Phase 4 Tap to Pay reuses it.
//
// Money model (matches the existing codebase):
//   1. Salon account = prepaid `qb_unapplied_credits`. "Drawing it down" applies
//      available credit to the resident's open invoices (FIFO), reducing balances.
//   2. Card = an off-session Stripe PaymentIntent on the resident's saved default
//      card (one-time card for in-app collection). New money in → qb_payments row
//      + FIFO apply to open invoices.
//   In both cases any passed bookingIds are flipped to paymentStatus='paid'.
//
// Stripe network calls happen OUTSIDE the DB transaction (max:1 pooled connection —
// never hold a transaction open across a network round-trip).

import { db } from '@/db'
import { bookings, facilities, qbInvoices, qbPayments, qbUnappliedCredits, residents, paymentMethods } from '@/db/schema'
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { calculateRevShare } from '@/lib/rev-share'
import { ensurePaymentsSchema } from '@/lib/payments-ddl'
import { getPlatformStripe, platformStripeKey, paymentsLiveEnabled } from './stripe-client'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type CollectMethod = 'salon_then_card' | 'card' | 'salon_account'

export interface CollectOptions {
  residentId: string
  amountCents: number
  bookingIds?: string[]
  invoiceIds?: string[]
  /** Override resident.autopayMethod. Defaults to the resident's setting, then 'salon_then_card'. */
  method?: CollectMethod
  /** Specific saved card; defaults to the resident's default active card. */
  paymentMethodId?: string
  /** User who triggered an in-app collection (stylist/admin). */
  collectedBy?: string | null
  /** 'auto_charge' (default) | 'stylist_collect' | 'manual'. */
  recordedVia?: string
  /** Prevents double charges on retries. */
  idempotencyKey?: string
}

export type CollectFailureCode =
  | 'not_configured'
  | 'no_card'
  | 'card_declined'
  | 'requires_action'
  | 'insufficient'
  | 'invalid'
  | 'over_limit'
  | 'error'

// Safeguard (2026-07-07): hard ceiling on a single AUTOMATIC card charge. A
// corrupted/mis-imported balance must never be pulled off-session in full —
// above this, the engine refuses and the failover pay-link lets the payor pay
// deliberately. Manual/in-app collections are not capped (operator-confirmed).
const AUTO_CHARGE_MAX_CENTS = 200_000 // $2,000

export type CollectResult =
  | {
      ok: true
      collectedCents: number
      salonCents: number
      cardCents: number
      paymentId?: string
      paymentIntentId?: string
    }
  | { ok: false; code: CollectFailureCode; reason: string; salonCents: number }

/** FIFO-apply `cents` of new money to the resident's open invoices (capped at `cents`). */
async function applyCentsToOpenInvoices(
  tx: Tx,
  residentId: string,
  cents: number,
  invoiceIds: string[] | undefined,
  stripePaymentIntentId: string | null,
): Promise<number> {
  if (cents <= 0) return 0
  const where = invoiceIds && invoiceIds.length
    ? and(eq(qbInvoices.residentId, residentId), inArray(qbInvoices.id, invoiceIds), gt(qbInvoices.openBalanceCents, 0))
    : and(eq(qbInvoices.residentId, residentId), gt(qbInvoices.openBalanceCents, 0))
  const open = await tx
    .select({ id: qbInvoices.id, openBalanceCents: qbInvoices.openBalanceCents })
    .from(qbInvoices)
    .where(where)
    .orderBy(asc(qbInvoices.invoiceDate), asc(qbInvoices.createdAt))

  let remaining = cents
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
        ...(stripePaymentIntentId && newOpen === 0 ? { stripePaymentIntentId, stripePaidAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(qbInvoices.id, inv.id))
    remaining -= take
  }
  return cents - remaining
}

/** Draw up to `capCents` of prepaid salon-account credit against open invoices (FIFO). */
async function drawSalonCredit(
  tx: Tx,
  residentId: string,
  capCents: number,
  invoiceIds: string[] | undefined,
): Promise<number> {
  if (capCents <= 0) return 0
  const credits = await tx
    .select({
      id: qbUnappliedCredits.id,
      openBalanceCents: qbUnappliedCredits.openBalanceCents,
      appliedCents: qbUnappliedCredits.appliedCents,
      appliedDetail: qbUnappliedCredits.appliedDetail,
    })
    .from(qbUnappliedCredits)
    .where(eq(qbUnappliedCredits.residentId, residentId))
    .orderBy(asc(qbUnappliedCredits.txnDate), asc(qbUnappliedCredits.createdAt))

  const where = invoiceIds && invoiceIds.length
    ? and(eq(qbInvoices.residentId, residentId), inArray(qbInvoices.id, invoiceIds), gt(qbInvoices.openBalanceCents, 0))
    : and(eq(qbInvoices.residentId, residentId), gt(qbInvoices.openBalanceCents, 0))
  const open = await tx
    .select({
      id: qbInvoices.id,
      invoiceNum: qbInvoices.invoiceNum,
      invoiceDate: qbInvoices.invoiceDate,
      openBalanceCents: qbInvoices.openBalanceCents,
    })
    .from(qbInvoices)
    .where(where)
    .orderBy(asc(qbInvoices.invoiceDate), asc(qbInvoices.createdAt))

  let cap = capCents
  const now = new Date()
  let totalApplied = 0

  for (const credit of credits) {
    if (cap <= 0) break
    let creditRemaining = Math.min(credit.openBalanceCents - credit.appliedCents, cap)
    if (creditRemaining <= 0) continue
    const allocations: Array<{ invoiceId: string; invoiceNum: string; invoiceDate: string; amountCents: number }> = []
    for (const inv of open) {
      if (creditRemaining <= 0) break
      if (inv.openBalanceCents <= 0) continue
      const take = Math.min(creditRemaining, inv.openBalanceCents)
      const newOpen = inv.openBalanceCents - take
      await tx
        .update(qbInvoices)
        .set({ openBalanceCents: newOpen, status: newOpen === 0 ? 'paid' : 'partial', updatedAt: now })
        .where(eq(qbInvoices.id, inv.id))
      inv.openBalanceCents = newOpen
      allocations.push({ invoiceId: inv.id, invoiceNum: inv.invoiceNum, invoiceDate: inv.invoiceDate, amountCents: take })
      creditRemaining -= take
      cap -= take
      totalApplied += take
    }
    if (allocations.length) {
      const applied = allocations.reduce((s, a) => s + a.amountCents, 0)
      await tx
        .update(qbUnappliedCredits)
        .set({
          appliedCents: credit.appliedCents + applied,
          appliedAt: now,
          appliedDetail: [...((credit.appliedDetail as typeof allocations | null) ?? []), ...allocations],
        })
        .where(eq(qbUnappliedCredits.id, credit.id))
    }
  }
  return totalApplied
}

/** Mark the given bookings paid with a method label + clear/record the autopay audit. */
async function markBookingsPaid(tx: Tx, bookingIds: string[], methodLabel: string): Promise<void> {
  if (!bookingIds.length) return
  await tx
    .update(bookings)
    .set({
      paymentStatus: 'paid',
      paymentMethod: methodLabel,
      autopayAttemptedAt: new Date(),
      autopayLastError: null,
      updatedAt: new Date(),
    })
    .where(and(inArray(bookings.id, bookingIds), eq(bookings.active, true)))
}

/**
 * Collect `amountCents` for a resident: draw the salon account and/or charge the
 * saved card per `method`, record the payment, apply to invoices, and mark any
 * bookings paid. Never throws for an expected decline — returns a structured
 * failure so callers can fire the failover pay-link.
 */
export async function collectForResident(opts: CollectOptions): Promise<CollectResult> {
  await ensurePaymentsSchema()
  // qb_unapplied_credits (remainder banking in Step 3) — module-guarded no-op.
  const { ensureUnappliedSchema } = await import('@/lib/unapplied-ddl')
  await ensureUnappliedSchema()

  if (!Number.isInteger(opts.amountCents) || opts.amountCents <= 0) {
    return { ok: false, code: 'invalid', reason: 'Nothing to collect', salonCents: 0 }
  }

  const resident = await db.query.residents.findFirst({
    where: eq(residents.id, opts.residentId),
    columns: { id: true, name: true, facilityId: true, stripeCustomerId: true, autopayMethod: true, qbCustomerId: true, poaEmail: true },
  })
  if (!resident) return { ok: false, code: 'invalid', reason: 'Resident not found', salonCents: 0 }

  // ── Safeguards (2026-07-07): never charge money that isn't due ─────────────
  // Booking-driven collects (on-completion): re-check the bookings are STILL
  // unpaid — a concurrent sweep/manual collect may already have settled them.
  if (opts.bookingIds?.length) {
    const stillUnpaid = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(
        inArray(bookings.id, opts.bookingIds),
        eq(bookings.active, true),
        sql`${bookings.paymentStatus} IS DISTINCT FROM 'paid'`,
      ))
    if (stillUnpaid.length === 0) {
      return { ok: false, code: 'invalid', reason: 'Already paid', salonCents: 0 }
    }
  } else {
    // Balance-driven collects (sweep + "Collect now"): clamp to the CURRENT open
    // invoice balance, freshly computed — the caller's amount may be stale (a
    // concurrent collect could have settled part or all of it). Prevents the
    // "charged twice for the same balance" race.
    const [freshRow] = await db
      .select({ n: sql<string>`COALESCE(SUM(${qbInvoices.openBalanceCents}), 0)` })
      .from(qbInvoices)
      .where(and(
        eq(qbInvoices.residentId, resident.id),
        eq(qbInvoices.isDemo, false),
        gt(qbInvoices.openBalanceCents, 0),
        ...(opts.invoiceIds?.length ? [inArray(qbInvoices.id, opts.invoiceIds)] : []),
      ))
    const freshOutstanding = Number(freshRow?.n ?? 0)
    if (freshOutstanding <= 0) {
      return { ok: false, code: 'invalid', reason: 'Nothing due — the balance is already settled', salonCents: 0 }
    }
    opts = { ...opts, amountCents: Math.min(opts.amountCents, freshOutstanding) }
  }

  const method: CollectMethod =
    opts.method ?? (resident.autopayMethod as CollectMethod | null) ?? 'salon_then_card'
  const allowSalon = method === 'salon_then_card' || method === 'salon_account'
  const allowCard = method === 'salon_then_card' || method === 'card'

  // ── Step 1: salon-account draw (own transaction) ───────────────────────────
  let salonCents = 0
  if (allowSalon) {
    try {
      salonCents = await db.transaction(async (tx) => {
        const applied = await drawSalonCredit(tx, resident.id, opts.amountCents, opts.invoiceIds)
        await recompute(tx, resident.facilityId)
        return applied
      })
    } catch (err) {
      console.error('[payments.collect] salon draw failed:', err)
    }
  }

  const remaining = opts.amountCents - salonCents
  if (remaining <= 0) {
    await db.transaction(async (tx) => {
      await markBookingsPaid(tx, opts.bookingIds ?? [], 'Salon Account')
    })
    bustBilling()
    return { ok: true, collectedCents: salonCents, salonCents, cardCents: 0 }
  }

  if (!allowCard) {
    // salon_account only and not fully covered → caller fires failover for the gap
    return { ok: false, code: 'insufficient', reason: 'Salon account balance is insufficient', salonCents }
  }

  // ── Step 2: charge the saved card for the remainder ────────────────────────
  const key = platformStripeKey()
  if (!key) return { ok: false, code: 'not_configured', reason: 'Card payments are not configured', salonCents }
  // Permit test keys always; block LIVE keys until the flag is flipped on go-live.
  if (key.startsWith('sk_live_') && !paymentsLiveEnabled()) {
    return { ok: false, code: 'not_configured', reason: 'Live card payments are disabled (PAYMENTS_LIVE_ENABLED)', salonCents }
  }

  // Safeguard: automatic (off-session, unattended) charges are capped — above the
  // ceiling the failover pay-link asks the payor to pay deliberately instead.
  if ((opts.recordedVia ?? 'auto_charge') === 'auto_charge' && remaining > AUTO_CHARGE_MAX_CENTS) {
    return {
      ok: false,
      code: 'over_limit',
      reason: `Balance ($${(remaining / 100).toFixed(2)}) is above the automatic-charge limit`,
      salonCents,
    }
  }

  const card = await db.query.paymentMethods.findFirst({
    where: opts.paymentMethodId
      ? // Always scope to the resident — an explicit paymentMethodId must belong to
        // THIS resident, never a card vaulted for someone else (IDOR guard).
        and(
          eq(paymentMethods.stripePaymentMethodId, opts.paymentMethodId),
          eq(paymentMethods.residentId, resident.id),
          eq(paymentMethods.active, true),
        )
      : and(eq(paymentMethods.residentId, resident.id), eq(paymentMethods.active, true)),
    orderBy: [desc(paymentMethods.isDefault), desc(paymentMethods.createdAt)],
  })
  if (!card || !resident.stripeCustomerId) {
    return { ok: false, code: 'no_card', reason: 'No saved card on file', salonCents }
  }

  const stripe = await getPlatformStripe()
  if (!stripe) return { ok: false, code: 'not_configured', reason: 'Card payments are not configured', salonCents }

  let paymentIntentId: string
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: remaining,
        currency: 'usd',
        customer: resident.stripeCustomerId,
        payment_method: card.stripePaymentMethodId,
        off_session: opts.recordedVia !== 'stylist_collect',
        confirm: true,
        metadata: {
          residentId: resident.id,
          facilityId: resident.facilityId,
          bookingIds: (opts.bookingIds ?? []).join(','),
          invoiceIds: (opts.invoiceIds ?? []).join(','),
        },
      },
      opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
    )
    if (pi.status === 'requires_action') {
      return { ok: false, code: 'requires_action', reason: 'Card requires additional authentication', salonCents }
    }
    if (pi.status !== 'succeeded') {
      return { ok: false, code: 'card_declined', reason: `Charge ${pi.status}`, salonCents }
    }
    paymentIntentId = pi.id
  } catch (err) {
    const e = err as { type?: string; code?: string; message?: string }
    const reason = e?.message ?? 'Card was declined'
    console.error('[payments.collect] card charge failed:', e?.type, e?.code, reason)
    return { ok: false, code: 'card_declined', reason, salonCents }
  }

  // ── Step 3: record the card payment, apply to invoices, mark bookings ──────
  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, resident.facilityId),
    columns: { name: true, timezone: true, revSharePercentage: true, qbRevShareType: true },
  })
  const split = calculateRevShare(remaining, facility?.revSharePercentage ?? null, facility?.qbRevShareType ?? null)

  let paymentId: string | undefined
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(qbPayments)
        .values({
          facilityId: resident.facilityId,
          residentId: resident.id,
          qbCustomerId: resident.qbCustomerId,
          amountCents: remaining,
          paymentMethod: 'card',
          paymentDate: new Date().toISOString().slice(0, 10),
          memo: `Card on file — ${resident.name}`,
          recordedVia: opts.recordedVia ?? 'auto_charge',
          stripePaymentIntentId: paymentIntentId,
          collectedBy: opts.collectedBy ?? null,
          revShareAmountCents: split.facilityShareCents,
          revShareType: split.revShareType,
          seniorStylistAmountCents: split.seniorStylistCents,
        })
        .returning({ id: qbPayments.id })
      paymentId = row.id
      const applied = await applyCentsToOpenInvoices(tx, resident.id, remaining, opts.invoiceIds, paymentIntentId)
      // Safeguard (2026-07-07): never orphan captured money. If part of the charge
      // had no open invoice to land on (e.g. on-completion before the QB invoice
      // exists), bank it as a salon-account credit — future collects draw it FIRST
      // (salon_then_card), so the same dollars are never charged twice.
      const unapplied = remaining - applied
      if (unapplied > 0) {
        await tx.insert(qbUnappliedCredits).values({
          facilityId: resident.facilityId,
          residentId: resident.id,
          qbCustomerId: resident.qbCustomerId ?? `RES-${resident.id.slice(0, 8)}`,
          txnType: 'Prepayment',
          txnDate: new Date().toISOString().slice(0, 10),
          num: `Card-on-file remainder · ${paymentIntentId}`,
          amountCents: unapplied,
          openBalanceCents: unapplied,
          appliedCents: 0,
        })
      }
      await markBookingsPaid(tx, opts.bookingIds ?? [], 'Card')
      await recompute(tx, resident.facilityId)
    })
  } catch (err) {
    // Money was captured at Stripe but our DB write failed — log loudly; the
    // payment exists in Stripe and can be reconciled from the dashboard.
    console.error('[payments.collect] DB write after successful charge failed:', err, { paymentIntentId })
  }

  // Safeguard (2026-07-07): every card-on-file charge sends the payor a receipt —
  // an automatic charge must never be silent. Fire-and-forget.
  if (resident.poaEmail) {
    void (async () => {
      const { sendEmail, buildAutoChargeReceiptHtml } = await import('@/lib/email')
      const cardLabel = card.brand ? `${card.brand.toUpperCase()} ••${card.last4 ?? ''}` : null
      await sendEmail({
        to: resident.poaEmail!,
        subject: `Receipt — ${facility?.name ?? 'Senior Stylist'}`,
        html: buildAutoChargeReceiptHtml({
          residentName: resident.name,
          facilityName: facility?.name ?? 'Senior Stylist',
          amountCents: remaining,
          cardLabel,
          dateLabel: new Date().toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
            timeZone: facility?.timezone ?? 'America/New_York',
          }),
        }),
      })
    })().catch((err) => console.error('[payments.collect] receipt send failed:', err))
  }

  bustBilling()
  return {
    ok: true,
    collectedCents: salonCents + remaining,
    salonCents,
    cardCents: remaining,
    paymentId,
    paymentIntentId,
  }
}

async function recompute(tx: Tx, facilityId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE residents r
    SET qb_outstanding_balance_cents = COALESCE((
      SELECT SUM(open_balance_cents) FROM qb_invoices WHERE resident_id = r.id AND is_demo = false
    ), 0)
    WHERE r.facility_id = ${facilityId}
  `)
  await tx.execute(sql`
    UPDATE facilities f
    SET qb_outstanding_balance_cents = COALESCE((
      SELECT SUM(open_balance_cents) FROM qb_invoices WHERE facility_id = f.id AND is_demo = false
    ), 0)
    WHERE f.id = ${facilityId}
  `)
}

function bustBilling(): void {
  revalidateTag('billing', {})
  revalidateTag('bookings', {})
}
