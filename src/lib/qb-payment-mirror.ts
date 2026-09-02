// QuickBooks payment MIRRORING — site-collected card payments (card on file,
// in-app collection, family-portal checkout — all Stripe) are written INTO
// QuickBooks as Payment objects applied to the same invoices, so a family that
// paid on the site shows as paid in the books too (Josh 2026-09-02: "the
// payment if it's collected through the site and also with Stripe [must]
// reflect the same on QuickBooks").
//
// Contracts:
// - The site payment is recorded FIRST (inside the existing payment tx) and a
//   queue row (`qb_payment_mirror_queue`) is enqueued in that same tx. The QB
//   write happens AFTER the tx (never a network call inside a transaction —
//   max:1 pool) via mirrorPaymentSoon(), and the nightly cron retries anything
//   that didn't finish (processPaymentMirrorQueue). A failed or slow mirror
//   never fails the payment.
// - Only the APPLIED portion is mirrored (one QB Payment line per invoice,
//   LinkedTxn → the QB invoice). Money the site banked as salon credit (no
//   open invoice to land on), salon-credit draws, credit applications and
//   scanned checks are NOT mirrored — the bookkeeper records those in QB.
// - Never double-record in QB: every mirrored payment carries a deterministic
//   PaymentRefNum (`SS-<12 hex of the payment id>`) and the worker looks that
//   ref up in QB BEFORE creating; a payment created in QB but not finalized
//   locally (crash between the two) is ADOPTED on retry, not created again.
//   Each line is capped at the invoice's LIVE QB balance, so a payment the
//   bookkeeper already entered by hand can't be applied twice; a row whose
//   qb_payments.qb_payment_id was stamped by the pull (bookkeeper entered the
//   same money in QB) is skipped.
// - On success the site-paid clamp is released by the mirrored amount
//   (recordSiteMirrored) — QuickBooks now knows about that money, so the
//   conservative `max(0, qb_open − site_paid)` would otherwise double-subtract.
// - Kill switch: QB_PAYMENT_MIRROR_ENABLED='false' pauses the worker (rows stay
//   pending and mirror when re-enabled). Default ON.

import { db } from '@/db'
import { qbInvoices, qbPaymentMirrorQueue, qbPayments, qbSyncState, quickbooksSyncLog } from '@/db/schema'
import { eq, inArray, sql } from 'drizzle-orm'
import { qbGet, qbPost, qbQuoteLiteral } from '@/lib/quickbooks'
import { isFacilityConnected } from '@/lib/qb-connection'
import { ensureQbSafetySchema } from '@/lib/qb-safety-ddl'
import { recordSiteMirrored } from '@/lib/qb-site-payments'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Exec = Tx | typeof db

export interface MirrorAllocation {
  invoiceId: string
  cents: number
}

export type MirrorSource = 'auto_charge' | 'stylist_collect' | 'portal_stripe' | 'manual'

const MAX_ATTEMPTS = 6
/** A 'processing' row older than this is a crashed worker — reclaimable. */
const STALE_PROCESSING_MINUTES = 10
/** How long mirrorPaymentSoon waits before handing the row to the cron. */
const INLINE_WAIT_MS = 8000
const MINOR = 'minorversion=75'

export function paymentMirrorEnabled(): boolean {
  return process.env.QB_PAYMENT_MIRROR_ENABLED !== 'false'
}

/** Deterministic QB PaymentRefNum (≤21 chars) for a site payment. */
export function mirrorRefFor(paymentId: string): string {
  return `SS-${paymentId.replace(/-/g, '').slice(0, 12).toUpperCase()}`
}

/**
 * Enqueue a site payment for mirroring. Call INSIDE the tx that recorded the
 * qb_payments row (after ensureQbSafetySchema() ran before the tx). No-op when
 * nothing was applied to an invoice. Idempotent on payment_id.
 */
export async function enqueuePaymentMirror(
  exec: Exec,
  opts: {
    paymentId: string
    facilityId: string
    residentId: string | null
    amountCents: number
    allocations: MirrorAllocation[]
    source: MirrorSource
    stripePaymentIntentId: string | null
  },
): Promise<boolean> {
  const allocations = opts.allocations.filter((a) => a.cents > 0)
  if (allocations.length === 0) return false
  await exec
    .insert(qbPaymentMirrorQueue)
    .values({
      paymentId: opts.paymentId,
      facilityId: opts.facilityId,
      residentId: opts.residentId,
      amountCents: opts.amountCents,
      allocations,
      ref: mirrorRefFor(opts.paymentId),
      source: opts.source,
      stripePaymentIntentId: opts.stripePaymentIntentId,
    })
    .onConflictDoNothing()
  return true
}

/**
 * Best-effort inline mirror right after the payment tx commits: waits up to
 * INLINE_WAIT_MS so a request handler isn't held hostage by a slow Intuit call.
 * The atomic claim + ref-based adoption make a frozen lambda mid-mirror safe —
 * the cron finishes it. Never throws.
 */
export async function mirrorPaymentSoon(paymentId: string): Promise<void> {
  if (!paymentMirrorEnabled()) return
  try {
    await Promise.race([
      mirrorQueuedPayment(paymentId),
      new Promise<void>((resolve) => setTimeout(resolve, INLINE_WAIT_MS)),
    ])
  } catch (err) {
    console.error('[qb-mirror] inline mirror failed (cron will retry):', err)
  }
}

export type MirrorOutcome =
  | { status: 'done'; qbPaymentId: string; mirroredCents: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string }
  | { status: 'noop' }

interface QBLinkedTxn {
  TxnId: string
  TxnType: string
}
interface QBPaymentObj {
  Id: string
  SyncToken?: string
  TotalAmt?: number
  PaymentRefNum?: string
  CustomerRef?: { value: string; name?: string }
  Line?: Array<{ Amount: number; LinkedTxn?: QBLinkedTxn[] }>
}
interface QBInvoiceObj {
  Id: string
  Balance?: number
  TotalAmt?: number
  CustomerRef?: { value: string; name?: string }
}

/**
 * Mirror ONE queued payment into QuickBooks. Claims the row atomically (a
 * double kick / kick + cron overlap runs once), adopts an existing QB payment
 * by ref, otherwise creates it, then finalizes locally. Never throws.
 */
export async function mirrorQueuedPayment(paymentId: string): Promise<MirrorOutcome> {
  if (!paymentMirrorEnabled()) return { status: 'noop' }
  await ensureQbSafetySchema()

  // Atomic claim — pending/failed under the attempt cap, or a stale
  // 'processing' row left by a crashed worker.
  const claimed = (await db.execute(sql`
    UPDATE qb_payment_mirror_queue
    SET status = 'processing', attempts = attempts + 1, updated_at = now()
    WHERE payment_id = ${paymentId}::uuid
      AND (
        (status IN ('pending', 'failed') AND attempts < ${MAX_ATTEMPTS}::int)
        OR (status = 'processing' AND updated_at < now() - (${STALE_PROCESSING_MINUTES}::int * interval '1 minute'))
      )
    RETURNING payment_id, facility_id, resident_id, amount_cents, allocations, ref, stripe_payment_intent_id, source
  `)) as unknown as Array<{
    payment_id: string
    facility_id: string
    resident_id: string | null
    amount_cents: number | string
    allocations: MirrorAllocation[]
    ref: string
    stripe_payment_intent_id: string | null
    source: string | null
  }>
  const row = claimed[0]
  if (!row) return { status: 'noop' }
  const facilityId = row.facility_id

  const skip = async (reason: string): Promise<MirrorOutcome> => {
    await db
      .update(qbPaymentMirrorQueue)
      .set({ status: 'skipped', skipReason: reason, updatedAt: new Date() })
      .where(eq(qbPaymentMirrorQueue.paymentId, paymentId))
    return { status: 'skipped', reason }
  }

  try {
    if (!(await isFacilityConnected(facilityId))) return skip('not_connected')

    const payment = await db.query.qbPayments.findFirst({
      where: eq(qbPayments.id, paymentId),
      columns: { id: true, qbPaymentId: true, paymentDate: true, amountCents: true, memo: true },
    })
    if (!payment) return skip('payment_missing')
    if (payment.amountCents <= 0) return skip('refunded')

    // Invoices this payment applied to, with their QB ids.
    const allocations = (row.allocations ?? []).filter((a) => a.cents > 0)
    const invoiceIds = allocations.map((a) => a.invoiceId)
    const invoices = invoiceIds.length
      ? await db
          .select({ id: qbInvoices.id, qbInvoiceId: qbInvoices.qbInvoiceId, invoiceNum: qbInvoices.invoiceNum })
          .from(qbInvoices)
          .where(inArray(qbInvoices.id, invoiceIds))
      : []
    const byLocalId = new Map(invoices.map((i) => [i.id, i]))
    const byQbInvoiceId = new Map(
      invoices.filter((i) => i.qbInvoiceId).map((i) => [i.qbInvoiceId as string, i]),
    )

    // (1) Adopt an existing QB payment with our ref (crash-safe retry).
    let qbPayment = await findQBPaymentByRef(facilityId, row.ref)

    // (2) A qb_payment_id already stamped by the PULL (not ours) means the
    //     bookkeeper recorded this same money in QB by hand — never duplicate.
    if (!qbPayment && payment.qbPaymentId) return skip('already_in_qb')

    if (!qbPayment) {
      const withQb = allocations
        .map((a) => ({ ...a, inv: byLocalId.get(a.invoiceId) }))
        .filter((a) => a.inv?.qbInvoiceId)
      if (withQb.length === 0) return skip('no_qb_invoice')

      // Live QB balances — cap each line so a payment already entered in QB
      // (by hand, before the pull stamped anything) is never applied twice.
      const lines: Array<{ qbInvoiceId: string; localInvoiceId: string; cents: number; customer: string }> = []
      let allZero = true
      for (const a of withQb) {
        const qbInvoiceId = a.inv!.qbInvoiceId as string
        const res = await qbGet<{ Invoice: QBInvoiceObj }>(facilityId, `/invoice/${qbInvoiceId}?${MINOR}`)
        const inv = res.Invoice
        const balanceCents = Math.round((inv.Balance ?? 0) * 100)
        const cents = Math.min(a.cents, balanceCents)
        if (balanceCents > 0) allZero = false
        if (cents <= 0 || !inv.CustomerRef?.value) continue
        lines.push({ qbInvoiceId, localInvoiceId: a.invoiceId, cents, customer: inv.CustomerRef.value })
      }
      if (lines.length === 0) return skip(allZero ? 'already_paid_in_qb' : 'nothing_to_apply')

      const customers = new Set(lines.map((l) => l.customer))
      if (customers.size > 1) {
        throw new Error('allocations span multiple QuickBooks customers — record this payment in QB manually')
      }
      const customerId = lines[0].customer
      const totalCents = lines.reduce((s, l) => s + l.cents, 0)
      const methodId = await getCardPaymentMethodId(facilityId)

      const body: Record<string, unknown> = {
        CustomerRef: { value: customerId },
        TotalAmt: totalCents / 100,
        TxnDate: payment.paymentDate,
        PaymentRefNum: row.ref,
        PrivateNote: `Senior Stylist — card payment collected on the site${
          row.stripe_payment_intent_id ? ` (Stripe ${row.stripe_payment_intent_id})` : ''
        }`.slice(0, 4000),
        ...(methodId ? { PaymentMethodRef: { value: methodId } } : {}),
        Line: lines.map((l) => ({
          Amount: l.cents / 100,
          LinkedTxn: [{ TxnId: l.qbInvoiceId, TxnType: 'Invoice' }],
        })),
      }
      // RequestId = the queue ref: a retried create after a dropped connection
      // replays Intuit's original response instead of minting a twin.
      const created = await qbPost<{ Payment: QBPaymentObj }>(facilityId, `/payment?${MINOR}`, body, {
        requestId: `mirror-${row.ref}`,
      })
      qbPayment = created.Payment
    }

    // Finalize locally from the QB object (same code for created + adopted).
    const applied: Array<{ localInvoiceId: string; cents: number }> = []
    for (const line of qbPayment.Line ?? []) {
      const txn = line.LinkedTxn?.find((t) => t.TxnType === 'Invoice')
      const local = txn ? byQbInvoiceId.get(txn.TxnId) : undefined
      const cents = Math.round((line.Amount ?? 0) * 100)
      if (local && cents > 0) applied.push({ localInvoiceId: local.id, cents })
    }
    const mirroredCents = Math.round((qbPayment.TotalAmt ?? 0) * 100)
    const now = new Date()
    await db.transaction(async (tx) => {
      await tx
        .update(qbPayments)
        .set({ qbPaymentId: qbPayment!.Id, syncedAt: now })
        .where(eq(qbPayments.id, paymentId))
      for (const a of applied) await recordSiteMirrored(tx, a.localInvoiceId, a.cents)
      await tx
        .update(qbPaymentMirrorQueue)
        .set({
          status: 'done',
          qbPaymentId: qbPayment!.Id,
          mirroredCents,
          mirroredAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(qbPaymentMirrorQueue.paymentId, paymentId))
    })
    logMirror(facilityId, 'success', `${row.ref} → QB Payment ${qbPayment.Id} ($${(mirroredCents / 100).toFixed(2)})`, null)
    return { status: 'done', qbPaymentId: qbPayment.Id, mirroredCents }
  } catch (err) {
    const message = ((err as Error).message ?? 'Unknown error').slice(0, 500)
    console.error('[qb-mirror] mirror failed:', paymentId, message)
    await db
      .update(qbPaymentMirrorQueue)
      .set({ status: 'failed', lastError: message, updatedAt: new Date() })
      .where(eq(qbPaymentMirrorQueue.paymentId, paymentId))
      .catch((e) => console.error('[qb-mirror] failed to mark failed:', e))
    logMirror(facilityId, 'error', null, message)
    return { status: 'failed', error: message }
  }
}

/**
 * Cron entry: mirror every retryable row for a facility (oldest first).
 * Sequential — each mirror is a few Intuit calls; the cron budget caps `limit`.
 */
export async function processPaymentMirrorQueue(
  facilityId: string,
  limit = 25,
): Promise<{ attempted: number; done: number; skipped: number; failed: number }> {
  const out = { attempted: 0, done: 0, skipped: 0, failed: 0 }
  if (!paymentMirrorEnabled()) return out
  await ensureQbSafetySchema()
  const rows = (await db.execute(sql`
    SELECT payment_id
    FROM qb_payment_mirror_queue
    WHERE facility_id = ${facilityId}::uuid
      AND (
        (status IN ('pending', 'failed') AND attempts < ${MAX_ATTEMPTS}::int)
        OR (status = 'processing' AND updated_at < now() - (${STALE_PROCESSING_MINUTES}::int * interval '1 minute'))
      )
      AND created_at > now() - interval '60 days'
    ORDER BY created_at ASC
    LIMIT ${limit}
  `)) as unknown as Array<{ payment_id: string }>
  for (const r of rows) {
    out.attempted++
    const res = await mirrorQueuedPayment(r.payment_id)
    if (res.status === 'done') out.done++
    else if (res.status === 'skipped') out.skipped++
    else if (res.status === 'failed') out.failed++
  }
  return out
}

/**
 * Void a mirrored QB payment (used by the in-app refund). QuickBooks keeps the
 * transaction with zeroed amounts and re-opens the linked invoice, which the
 * next nightly pull reflects on the site. Never throws.
 */
export async function voidMirroredPayment(
  facilityId: string,
  qbPaymentId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await qbGet<{ Payment: QBPaymentObj }>(facilityId, `/payment/${qbPaymentId}?${MINOR}`)
    const syncToken = res.Payment?.SyncToken
    if (!syncToken) return { ok: false, error: 'QuickBooks payment not found' }
    await qbPost(facilityId, `/payment?operation=update&include=void&${MINOR}`, {
      Id: qbPaymentId,
      SyncToken: syncToken,
      sparse: true,
    })
    logMirror(facilityId, 'success', `voided QB Payment ${qbPaymentId} (site refund)`, null)
    return { ok: true }
  } catch (err) {
    const message = ((err as Error).message ?? 'Unknown error').slice(0, 500)
    console.error('[qb-mirror] void failed:', qbPaymentId, message)
    logMirror(facilityId, 'error', null, `void ${qbPaymentId}: ${message}`)
    return { ok: false, error: message }
  }
}

/** Queue rows for a facility keyed by ref — the payment pull's safety net. */
export async function loadMirrorRefs(
  facilityId: string,
): Promise<Map<string, { paymentId: string; status: string }>> {
  await ensureQbSafetySchema()
  const rows = await db
    .select({ paymentId: qbPaymentMirrorQueue.paymentId, ref: qbPaymentMirrorQueue.ref, status: qbPaymentMirrorQueue.status })
    .from(qbPaymentMirrorQueue)
    .where(eq(qbPaymentMirrorQueue.facilityId, facilityId))
  return new Map(rows.map((r) => [r.ref, { paymentId: r.paymentId, status: r.status }]))
}

// ── helpers ──────────────────────────────────────────────────────────────

async function findQBPaymentByRef(facilityId: string, ref: string): Promise<QBPaymentObj | null> {
  const query = `SELECT * FROM Payment WHERE PaymentRefNum = ${qbQuoteLiteral(ref)}`
  const res = await qbGet<{ QueryResponse?: { Payment?: QBPaymentObj[] } }>(
    facilityId,
    `/query?query=${encodeURIComponent(query)}&${MINOR}`,
  )
  return res.QueryResponse?.Payment?.[0] ?? null
}

/** QB PaymentMethod id for "Credit Card" — cached per facility; null when absent. */
async function getCardPaymentMethodId(facilityId: string): Promise<string | null> {
  try {
    const state = await db.query.qbSyncState.findFirst({
      where: eq(qbSyncState.facilityId, facilityId),
      columns: { qbCardPaymentMethodId: true },
    })
    if (state?.qbCardPaymentMethodId) return state.qbCardPaymentMethodId
    const res = await qbGet<{ QueryResponse?: { PaymentMethod?: Array<{ Id: string; Name?: string; Type?: string }> } }>(
      facilityId,
      `/query?query=${encodeURIComponent("SELECT * FROM PaymentMethod WHERE Active = true")}&${MINOR}`,
    )
    const methods = res.QueryResponse?.PaymentMethod ?? []
    const card =
      methods.find((m) => m.Name?.toLowerCase() === 'credit card') ??
      methods.find((m) => m.Type === 'CREDIT_CARD') ??
      null
    if (!card) return null
    await db
      .insert(qbSyncState)
      .values({ facilityId, qbCardPaymentMethodId: card.Id })
      .onConflictDoUpdate({
        target: qbSyncState.facilityId,
        set: { qbCardPaymentMethodId: card.Id, updatedAt: new Date() },
      })
    return card.Id
  } catch {
    return null // best-effort — a payment without a method ref is still valid
  }
}

function logMirror(facilityId: string, status: 'success' | 'error', responseSummary: string | null, errorMessage: string | null) {
  db.insert(quickbooksSyncLog)
    .values({ facilityId, action: 'mirror_payment', status, responseSummary, errorMessage })
    .catch((e) => console.error('[qb-log]', e))
}
