// qb_sync_runs — one row per QuickBooks operation, carrying enough detail for
// src/lib/qb-undo.ts to reverse it AND for src/lib/qb-run-detail.ts to show the
// operator exactly what changed on each side. Recording is best-effort: a
// failure to write the audit row never fails the operation it describes.
//
// TWO KINDS OF FIELD LIVE HERE, and the difference is load-bearing:
//   • ID ARRAYS undo reads directly (`bookingIds`, `insertedPaymentIds`,
//     `insertedCreditIds`, `insertedInvoiceIds`, `createdLinks`). Their SHAPE IS
//     FROZEN — undo does `inArray(table.id, chunk)` and counts `chunk.length`,
//     so turning one into an array of objects silently breaks the reversal.
//   • LABEL FIELDS (everything optional below) exist only to render history.
//     They are additive, capped, and never read by undo.
// Add display detail as a NEW optional key. Never repurpose an id array.

import { db } from '@/db'
import { qbSyncRuns } from '@/db/schema'
import { ensureQbSafetySchema } from '@/lib/qb-safety-ddl'

export type QbRunAction = 'push_invoice' | 'sync_customers' | 'sync_payments' | 'sync_invoices'

/** Cap on any display-only array, so `items` can't grow unbounded and cost us
 *  the undo record it shares a row with. */
export const LABEL_CAP = 500

export interface RunLabelBooking {
  dateLabel: string
  description: string
  amountCents: number
}

export interface PushInvoiceRunItems {
  month: string
  mode: 'per_resident' | 'facility'
  invoices: Array<{
    qbInvoiceId: string
    localInvoiceId: string
    /** FROZEN — undo re-frees exactly these bookings. */
    bookingIds: string[]
    residentId: string | null
    residentName: string | null
    amountCents: number
    // ── display labels (optional; absent on runs recorded before P60) ──
    /** QuickBooks DocNumber — the only id a bookkeeper can search on. */
    invoiceNum?: string
    invoiceDate?: string
    /** The invoice's lines, capped per invoice. */
    bookings?: RunLabelBooking[]
    bookingsTruncated?: number
    /** Did QuickBooks actually email it, and to whom. */
    emailed?: boolean
    emailedTo?: string | null
    emailError?: string
  }>
  /** Residents deliberately NOT invoiced because a card on file collects them. */
  skippedAutopay?: Array<{
    residentName: string
    roomNumber: string | null
    bookingCount: number
    amountCents: number
  }>
  /** QuickBooks customers this push minted as a side effect. Undo does NOT
   *  reverse these — the panel says so. */
  createdCustomers?: Array<{ qbCustomerId: string; displayName: string; kind: 'facility' | 'resident' }>
  /** The 'Salon Services' item, created on a facility's first push. */
  serviceItemCreated?: { name: string; incomeAccountName: string | null }
}

export interface SyncCustomersRunItems {
  /** FROZEN — undo deactivates exactly these QuickBooks customers. A merely
   *  MATCHED customer must never appear here; it would deactivate the
   *  facility's real record. */
  createdLinks: Array<{ linkId: string; qbCustomerId: string; residentId: string | null; displayName: string | null }>
  // ── display labels ──
  /** Residents bound to a QuickBooks customer that already existed. */
  matchedLinks?: Array<{
    residentName: string | null
    roomNumber: string | null
    qbDisplayName: string | null
    /** How the bind was made — 'fuzzy' is the only one that can be wrong. */
    matchMethod: 'stored_name' | 'display_name' | 'fuzzy' | 'exact_name'
  }>
  matchedTruncated?: number
  /** The facility's parent customer this run resolved or created. */
  parentCustomer?: {
    displayName: string | null
    created: boolean
    /** Set when the run re-pointed the facility at a DIFFERENT QuickBooks customer. */
    repointedFrom?: string
  }
}

export interface SyncPaymentsRunItems {
  prevCursor: string | null
  prevLastSyncedAt: string | null
  /** FROZEN — undo deletes these rows. */
  insertedPaymentIds: string[]
  /** Existing (CSV/check-scan) rows that got their qb_payment_id stamped. */
  stamped: Array<{ id: string; memoWasNull: boolean; label?: PaymentLabel }>
  /** Facility-level rows upgraded to a resident (resident_id + qb_customer_id were null). */
  upgraded: Array<{ id: string; memoWasNull: boolean; label?: PaymentLabel }>
  /** Already-synced rows whose amount/date were refreshed from QB. */
  refreshed: Array<{
    id: string
    prevAmountCents: number
    prevPaymentDate: string
    memoWasNull: boolean
    label?: PaymentLabel
    newAmountCents?: number
    newPaymentDate?: string
  }>
  /** FROZEN — undo deletes these rows. */
  insertedCreditIds: string[]
  updatedCredits: Array<{ id: string; prevOpenBalanceCents: number; label?: CreditLabel }>
  // ── display labels for the DELETE paths (unrecoverable after an undo) ──
  insertedPayments?: PaymentLabel[]
  insertedPaymentsTruncated?: number
  insertedCredits?: CreditLabel[]
  insertedCreditsTruncated?: number
}

/** A payment as a bookkeeper reads it — snapshotted because undo deletes the row. */
export interface PaymentLabel {
  checkNum: string | null
  paymentDate: string | null
  amountCents: number
  residentName: string | null
  roomNumber: string | null
}

export interface CreditLabel {
  txnType: string | null
  num: string | null
  txnDate: string | null
  amountCents: number
  openBalanceCents: number
  residentName: string | null
}

export interface SyncInvoicesRunItems {
  prevCursor: string | null
  prevLastSyncedAt: string | null
  /** FROZEN — undo deletes these rows. */
  insertedInvoiceIds: string[]
  updated: Array<{
    id: string
    prevOpenBalanceCents: number
    prevStatus: string
    prevAmountCents: number
    // ── display labels ──
    label?: InvoiceLabel
    newOpenBalanceCents?: number
    newStatus?: string
    newAmountCents?: number
  }>
  // ── display labels for the DELETE path ──
  insertedInvoices?: InvoiceLabel[]
  insertedInvoicesTruncated?: number
  /**
   * Invoices where QuickBooks AND the site both show a payment — the possible
   * double-payments the operator must confirm by hand. UUID-free by
   * construction: this is display data, never an id the client could act on.
   */
  ambiguous?: Array<{
    invoiceNum: string
    residentName: string | null
    qbOpenCents: number
    sitePaidCents: number
  }>
}

export interface InvoiceLabel {
  invoiceNum: string
  invoiceDate: string | null
  amountCents: number
  openBalanceCents: number
  status: string | null
  residentName: string | null
  roomNumber: string | null
}

export type QbRunItems =
  | PushInvoiceRunItems
  | SyncCustomersRunItems
  | SyncPaymentsRunItems
  | SyncInvoicesRunItems

/** Cap a display-only array and report how much was dropped (never silently). */
export function capLabels<T>(rows: T[], cap = LABEL_CAP): { rows: T[]; truncated: number } {
  return rows.length <= cap
    ? { rows, truncated: 0 }
    : { rows: rows.slice(0, cap), truncated: rows.length - cap }
}

export async function recordSyncRun(opts: {
  facilityId: string
  action: QbRunAction
  startedAt: Date
  createdBy: string | null
  summary: Record<string, unknown>
  items: QbRunItems
}): Promise<string | null> {
  try {
    await ensureQbSafetySchema()
    const [row] = await db
      .insert(qbSyncRuns)
      .values({
        facilityId: opts.facilityId,
        action: opts.action,
        startedAt: opts.startedAt,
        finishedAt: new Date(),
        createdBy: opts.createdBy,
        summary: opts.summary,
        // jsonb column is typed Record<string, unknown>; the per-action item
        // interfaces have no index signature, so widen at the boundary.
        items: opts.items as unknown as Record<string, unknown>,
      })
      .returning({ id: qbSyncRuns.id })
    return row?.id ?? null
  } catch (err) {
    console.error('[qb-runs] failed to record run:', err)
    return null
  }
}
