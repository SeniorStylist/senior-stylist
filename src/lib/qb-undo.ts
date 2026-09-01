// Per-run UNDO for QuickBooks operations, driven by the undo data each sync
// records in qb_sync_runs (src/lib/qb-runs.ts).
//
// Reversal rules (what is and isn't safe to unwind):
// - push_invoice   → VOID the pushed invoices in QuickBooks (void, not delete —
//                    accountants keep the record) + mark local rows 'void' +
//                    re-free the bookings. An invoice that already has money
//                    applied — on the site OR in QuickBooks (we read the live
//                    Balance) — is SKIPPED and reported: voiding a paid invoice
//                    is a bookkeeping decision, not a button. A QuickBooks error
//                    that is NOT "not found" leaves local state untouched.
// - sync_customers → deactivate ONLY the customers the run CREATED (matched
//                    links are pure mappings). QB refuses to deactivate a
//                    customer with a balance; that's reported, not forced.
// - sync_payments  → delete pulled payment rows, un-stamp CSV/check-scan rows,
//                    revert facility→resident upgrades, restore refreshed
//                    amounts/dates, delete pulled credits (never site-applied
//                    ones), restore prior credit balances, restore the cursor.
// - sync_invoices  → restore every updated invoice's prior open balance/status/
//                    amount, delete pulled-in rows that nothing references,
//                    restore the cursor + last-synced. Site-paid clamping is
//                    re-applied afterwards so later site payments stay honored.
//
// Concurrency + retry contract: the run is CLAIMED atomically (undone_at set
// where it was NULL) before any work, so two concurrent undos can't both run.
// If the handler finishes with errors the claim is RELEASED (undone_at back to
// NULL, errors kept in undo_summary) so the operator can retry after fixing
// the cause — every step is idempotent, so a retry only redoes what's left.
//
// Pull undos must go LIFO (newest first) — undoing an older pull under a newer
// one would restore values the newer pull already superseded.

import { db } from '@/db'
import {
  bookings,
  facilities,
  qbCustomerLinks,
  qbInvoices,
  qbPayments,
  qbSyncRuns,
  qbUnappliedCredits,
} from '@/db/schema'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { qbGet, qbPost } from '@/lib/quickbooks'
import { ensureQbSafetySchema } from '@/lib/qb-safety-ddl'
import { loadSitePaidMap, reapplySitePayments } from '@/lib/qb-site-payments'
import { recomputeFacilityBalances } from '@/lib/unapplied-apply'
import { chunkArr } from '@/lib/imports/qb-csv'
import type {
  PushInvoiceRunItems,
  SyncCustomersRunItems,
  SyncInvoicesRunItems,
  SyncPaymentsRunItems,
} from '@/lib/qb-runs'

export interface UndoResult {
  action: string
  reversed: number
  skipped: number
  errors: string[]
  notes: string[]
  /** false = finished with errors; the run stays undo-able so it can be retried. */
  completed: boolean
}

const QB_NOT_FOUND_RE = /\b404\b|Object Not Found|"code"\s*:\s*"610"|\b610\b/i

export async function undoSyncRun(runId: string, userId: string): Promise<UndoResult> {
  await ensureQbSafetySchema()
  const run = await db.query.qbSyncRuns.findFirst({ where: eq(qbSyncRuns.id, runId) })
  if (!run) throw new Error('Run not found')
  const facilityId = run.facilityId
  const result: UndoResult = {
    action: run.action,
    reversed: 0,
    skipped: 0,
    errors: [],
    notes: [],
    completed: false,
  }

  // Atomic claim — the only guard that holds under a double-submit.
  const claimed = await db
    .update(qbSyncRuns)
    .set({ undoneAt: new Date(), undoneBy: userId })
    .where(and(eq(qbSyncRuns.id, runId), isNull(qbSyncRuns.undoneAt)))
    .returning({ id: qbSyncRuns.id })
  if (claimed.length === 0) throw new Error('This run was already undone (or an undo is in progress)')

  const release = async (summary?: Record<string, unknown>) => {
    await db
      .update(qbSyncRuns)
      .set({ undoneAt: null, undoneBy: null, ...(summary ? { undoSummary: summary } : {}) })
      .where(eq(qbSyncRuns.id, runId))
  }

  try {
    // LIFO guard for pulls.
    if (run.action === 'sync_invoices' || run.action === 'sync_payments') {
      const newer = await db.query.qbSyncRuns.findFirst({
        where: and(
          eq(qbSyncRuns.facilityId, facilityId),
          eq(qbSyncRuns.action, run.action),
          isNull(qbSyncRuns.undoneAt),
          sql`${qbSyncRuns.startedAt} > ${run.startedAt.toISOString()}::timestamptz`,
        ),
        orderBy: desc(qbSyncRuns.startedAt),
        columns: { id: true },
      })
      if (newer) {
        throw new Error('A newer sync of the same kind ran after this one — undo that one first (newest to oldest)')
      }
    }

    switch (run.action) {
      case 'push_invoice':
        await undoPushInvoice(facilityId, run.items as unknown as PushInvoiceRunItems, result)
        break
      case 'sync_customers':
        await undoSyncCustomers(facilityId, run.items as unknown as SyncCustomersRunItems, result)
        break
      case 'sync_payments':
        await undoSyncPayments(facilityId, run.items as unknown as SyncPaymentsRunItems, result)
        break
      case 'sync_invoices':
        await undoSyncInvoices(facilityId, run.items as unknown as SyncInvoicesRunItems, result)
        break
      default:
        throw new Error(`Undo is not supported for ${run.action}`)
    }
  } catch (err) {
    await release().catch(() => {})
    throw err
  }

  const summary = {
    reversed: result.reversed,
    skipped: result.skipped,
    errors: result.errors.slice(0, 10),
    notes: result.notes.slice(0, 10),
    at: new Date().toISOString(),
  }
  result.completed = result.errors.length === 0
  if (result.completed) {
    await db.update(qbSyncRuns).set({ undoSummary: summary }).where(eq(qbSyncRuns.id, runId))
  } else {
    // Keep it retryable: release the claim but remember what went wrong.
    await release(summary)
  }

  return result
}

// ── push_invoice ─────────────────────────────────────────────────────────

async function undoPushInvoice(
  facilityId: string,
  items: PushInvoiceRunItems,
  result: UndoResult,
): Promise<void> {
  const invoices = items?.invoices ?? []
  if (invoices.length === 0) return
  const sitePaid = await loadSitePaidMap(facilityId)
  const locals = await db.query.qbInvoices.findMany({
    where: inArray(qbInvoices.id, invoices.map((i) => i.localInvoiceId)),
    columns: { id: true, openBalanceCents: true, amountCents: true, status: true },
  })
  const localById = new Map(locals.map((l) => [l.id, l]))

  for (const item of invoices) {
    const label = item.residentName ?? 'facility invoice'
    const local = localById.get(item.localInvoiceId)
    if (local?.status === 'void') {
      result.skipped++ // already reversed (a retry)
      continue
    }
    // Money already applied on the site → not a button decision.
    if ((sitePaid.get(item.localInvoiceId) ?? 0) > 0 || (local && local.openBalanceCents < local.amountCents)) {
      result.skipped++
      result.notes.push(`${label}: a payment is already applied on the site — void it manually in QuickBooks if needed`)
      continue
    }

    // Fetch the live QB invoice: SyncToken for the void call, and Balance to
    // catch payments applied INSIDE QuickBooks that the site can't see while
    // the invoice pull is flag-gated. Only a definite "not found" falls
    // through to local cleanup; any other QB error leaves state untouched.
    let qb: { SyncToken: string; Balance?: number; TotalAmt?: number } | null = null
    try {
      const got = await qbGet<{ Invoice: { Id: string; SyncToken: string; Balance?: number; TotalAmt?: number } }>(
        facilityId,
        `/invoice/${item.qbInvoiceId}?minorversion=65`,
      )
      qb = got.Invoice ?? null
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (QB_NOT_FOUND_RE.test(msg)) {
        result.notes.push(`${label}: no longer exists in QuickBooks — cleaned up locally`)
      } else {
        result.errors.push(`${label}: could not reach QuickBooks — ${msg.slice(0, 150)}`)
        continue
      }
    }
    if (qb && typeof qb.Balance === 'number' && typeof qb.TotalAmt === 'number' && qb.Balance < qb.TotalAmt) {
      result.skipped++
      result.notes.push(`${label}: a payment is applied to it in QuickBooks — void it manually there if needed`)
      continue
    }

    try {
      if (qb) {
        await qbPost(facilityId, '/invoice?operation=void&minorversion=65', {
          Id: item.qbInvoiceId,
          SyncToken: qb.SyncToken,
        })
      }
      await db
        .update(qbInvoices)
        .set({ status: 'void', openBalanceCents: 0, updatedAt: new Date() })
        .where(eq(qbInvoices.id, item.localInvoiceId))
      if (item.bookingIds.length > 0) {
        await db
          .update(bookings)
          .set({ qbInvoiceMatchId: null, updatedAt: new Date() })
          .where(
            and(inArray(bookings.id, item.bookingIds), eq(bookings.qbInvoiceMatchId, item.localInvoiceId)),
          )
      }
      result.reversed++
    } catch (err) {
      result.errors.push(`${label}: ${(err as Error).message?.slice(0, 200)}`)
    }
  }
  await recomputeFacilityBalances(db, [facilityId])
}

// ── sync_customers ───────────────────────────────────────────────────────

async function undoSyncCustomers(
  facilityId: string,
  items: SyncCustomersRunItems,
  result: UndoResult,
): Promise<void> {
  const created = items?.createdLinks ?? []
  if (created.length === 0) return
  const stillLinked = await db.query.qbCustomerLinks.findMany({
    where: inArray(qbCustomerLinks.id, created.map((c) => c.linkId)),
    columns: { id: true },
  })
  const liveLinkIds = new Set(stillLinked.map((l) => l.id))

  for (const link of created) {
    if (!liveLinkIds.has(link.linkId)) {
      result.skipped++ // already reversed (a retry)
      continue
    }
    const label = link.displayName ?? link.qbCustomerId
    try {
      const got = await qbGet<{ Customer: { Id: string; SyncToken: string } }>(
        facilityId,
        `/customer/${link.qbCustomerId}?minorversion=65`,
      )
      await qbPost(facilityId, '/customer?minorversion=65', {
        Id: link.qbCustomerId,
        SyncToken: got.Customer.SyncToken,
        sparse: true,
        Active: false,
      })
      await db.delete(qbCustomerLinks).where(eq(qbCustomerLinks.id, link.linkId))
      result.reversed++
    } catch (err) {
      // e.g. QB refuses to deactivate a customer that has a balance.
      result.errors.push(`${label}: ${(err as Error).message?.slice(0, 200)}`)
    }
  }
}

// ── sync_payments ────────────────────────────────────────────────────────

async function undoSyncPayments(
  facilityId: string,
  items: SyncPaymentsRunItems,
  result: UndoResult,
): Promise<void> {
  const inserted = items?.insertedPaymentIds ?? []
  const stamped = items?.stamped ?? []
  const upgraded = items?.upgraded ?? []
  const refreshed = items?.refreshed ?? []
  const insertedCredits = items?.insertedCreditIds ?? []
  const updatedCredits = items?.updatedCredits ?? []

  try {
    for (const ch of chunkArr(inserted, 200)) {
      await db.delete(qbPayments).where(and(inArray(qbPayments.id, ch), eq(qbPayments.facilityId, facilityId)))
      result.reversed += ch.length
    }

    const memoNullIds = [
      ...stamped.filter((s) => s.memoWasNull).map((s) => s.id),
      ...upgraded.filter((s) => s.memoWasNull).map((s) => s.id),
      ...refreshed.filter((s) => s.memoWasNull).map((s) => s.id),
    ]
    for (const ch of chunkArr(stamped.map((s) => s.id), 200)) {
      await db
        .update(qbPayments)
        .set({ qbPaymentId: null, syncedAt: null })
        .where(and(inArray(qbPayments.id, ch), eq(qbPayments.facilityId, facilityId)))
      result.reversed += ch.length
    }
    for (const ch of chunkArr(upgraded.map((s) => s.id), 200)) {
      await db
        .update(qbPayments)
        .set({ qbPaymentId: null, syncedAt: null, residentId: null, qbCustomerId: null })
        .where(and(inArray(qbPayments.id, ch), eq(qbPayments.facilityId, facilityId)))
      result.reversed += ch.length
    }
    for (const ch of chunkArr(refreshed, 200)) {
      const valueRows = ch.map((r) => sql`(${r.id}::uuid, ${r.prevAmountCents}::integer, ${r.prevPaymentDate}::date)`)
      await db.execute(sql`
        UPDATE qb_payments p SET amount_cents = v.amount_cents, payment_date = v.payment_date
        FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, amount_cents, payment_date)
        WHERE p.id = v.id AND p.facility_id = ${facilityId}::uuid
      `)
      result.reversed += ch.length
    }
    for (const ch of chunkArr(memoNullIds, 200)) {
      await db
        .update(qbPayments)
        .set({ memo: null })
        .where(and(inArray(qbPayments.id, ch), eq(qbPayments.facilityId, facilityId)))
    }

    // Credits: never delete a credit the site has applied since.
    if (insertedCredits.length > 0) {
      const applied = await db.query.qbUnappliedCredits.findMany({
        where: and(inArray(qbUnappliedCredits.id, insertedCredits), sql`${qbUnappliedCredits.appliedCents} > 0`),
        columns: { id: true },
      })
      const keep = new Set(applied.map((a) => a.id))
      if (keep.size > 0) {
        result.skipped += keep.size
        result.notes.push(`${keep.size} pulled credit(s) kept — already applied to invoices on the site`)
      }
      const deletable = insertedCredits.filter((id) => !keep.has(id))
      for (const ch of chunkArr(deletable, 200)) {
        await db.delete(qbUnappliedCredits).where(inArray(qbUnappliedCredits.id, ch))
        result.reversed += ch.length
      }
    }
    for (const ch of chunkArr(updatedCredits, 200)) {
      const valueRows = ch.map((c) => sql`(${c.id}::uuid, ${c.prevOpenBalanceCents}::integer)`)
      await db.execute(sql`
        UPDATE qb_unapplied_credits c SET open_balance_cents = v.open_balance_cents
        FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, open_balance_cents)
        WHERE c.id = v.id
      `)
      result.reversed += ch.length
    }

    // Cursor back to where it was, so the next sync re-covers this window.
    await db.execute(sql`
      INSERT INTO qb_sync_state (facility_id, payments_sync_cursor, payments_last_synced_at, updated_at)
      VALUES (${facilityId}::uuid, ${items?.prevCursor ?? null}, ${items?.prevLastSyncedAt ?? null}::timestamptz, now())
      ON CONFLICT (facility_id) DO UPDATE SET
        payments_sync_cursor = excluded.payments_sync_cursor,
        payments_last_synced_at = excluded.payments_last_synced_at,
        updated_at = excluded.updated_at
    `)
  } catch (err) {
    result.errors.push(`Payment undo stopped: ${(err as Error).message?.slice(0, 200)}`)
  }
}

// ── sync_invoices ────────────────────────────────────────────────────────

async function undoSyncInvoices(
  facilityId: string,
  items: SyncInvoicesRunItems,
  result: UndoResult,
): Promise<void> {
  const inserted = items?.insertedInvoiceIds ?? []
  const updated = items?.updated ?? []

  try {
    // Restore prior state of every row the pull changed.
    for (const ch of chunkArr(updated, 200)) {
      const valueRows = ch.map(
        (u) => sql`(${u.id}::uuid, ${u.prevOpenBalanceCents}::integer, ${u.prevStatus}::text, ${u.prevAmountCents}::integer)`,
      )
      await db.execute(sql`
        UPDATE qb_invoices i SET
          open_balance_cents = v.open_balance_cents,
          status = v.status,
          amount_cents = v.amount_cents,
          updated_at = now()
        FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, open_balance_cents, status, amount_cents)
        WHERE i.id = v.id AND i.facility_id = ${facilityId}::uuid
      `)
      result.reversed += ch.length
    }

    // Delete pulled-in rows nothing depends on (no bookings linked, no site money).
    if (inserted.length > 0) {
      const sitePaid = await loadSitePaidMap(facilityId)
      const linked = await db
        .selectDistinct({ id: bookings.qbInvoiceMatchId })
        .from(bookings)
        .where(inArray(bookings.qbInvoiceMatchId, inserted))
      const linkedIds = new Set(linked.map((l) => l.id).filter((id): id is string => !!id))
      const deletable = inserted.filter((id) => !linkedIds.has(id) && !(sitePaid.get(id) ?? 0))
      const kept = inserted.length - deletable.length
      if (kept > 0) {
        result.skipped += kept
        result.notes.push(`${kept} pulled invoice(s) kept — bookings or site payments reference them`)
      }
      for (const ch of chunkArr(deletable, 200)) {
        await db.delete(qbInvoices).where(and(inArray(qbInvoices.id, ch), eq(qbInvoices.facilityId, facilityId)))
        result.reversed += ch.length
      }
    }

    await db
      .update(facilities)
      .set({
        qbInvoicesSyncCursor: items?.prevCursor ?? null,
        qbInvoicesLastSyncedAt: items?.prevLastSyncedAt ? new Date(items.prevLastSyncedAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(facilities.id, facilityId))

    await reapplySitePayments(db, [facilityId])
    await recomputeFacilityBalances(db, [facilityId])
  } catch (err) {
    result.errors.push(`Invoice undo stopped: ${(err as Error).message?.slice(0, 200)}`)
  }
}
