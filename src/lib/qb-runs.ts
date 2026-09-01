// qb_sync_runs — one row per QuickBooks operation, carrying enough detail for
// src/lib/qb-undo.ts to reverse it. Recording is best-effort: a failure to
// write the audit row never fails the operation it describes.

import { db } from '@/db'
import { qbSyncRuns } from '@/db/schema'
import { ensureQbSafetySchema } from '@/lib/qb-safety-ddl'

export type QbRunAction = 'push_invoice' | 'sync_customers' | 'sync_payments' | 'sync_invoices'

export interface PushInvoiceRunItems {
  month: string
  mode: 'per_resident' | 'facility'
  invoices: Array<{
    qbInvoiceId: string
    localInvoiceId: string
    bookingIds: string[]
    residentId: string | null
    residentName: string | null
    amountCents: number
  }>
}

export interface SyncCustomersRunItems {
  createdLinks: Array<{ linkId: string; qbCustomerId: string; residentId: string | null; displayName: string | null }>
}

export interface SyncPaymentsRunItems {
  prevCursor: string | null
  prevLastSyncedAt: string | null
  insertedPaymentIds: string[]
  /** Existing (CSV/check-scan) rows that got their qb_payment_id stamped. */
  stamped: Array<{ id: string; memoWasNull: boolean }>
  /** Facility-level rows upgraded to a resident (resident_id + qb_customer_id were null). */
  upgraded: Array<{ id: string; memoWasNull: boolean }>
  /** Already-synced rows whose amount/date were refreshed from QB. */
  refreshed: Array<{ id: string; prevAmountCents: number; prevPaymentDate: string; memoWasNull: boolean }>
  insertedCreditIds: string[]
  updatedCredits: Array<{ id: string; prevOpenBalanceCents: number }>
}

export interface SyncInvoicesRunItems {
  prevCursor: string | null
  prevLastSyncedAt: string | null
  insertedInvoiceIds: string[]
  updated: Array<{ id: string; prevOpenBalanceCents: number; prevStatus: string; prevAmountCents: number }>
}

export type QbRunItems =
  | PushInvoiceRunItems
  | SyncCustomersRunItems
  | SyncPaymentsRunItems
  | SyncInvoicesRunItems

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
