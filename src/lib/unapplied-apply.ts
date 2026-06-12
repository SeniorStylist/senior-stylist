// Site-side application of unapplied QB credits to open invoices. Shared between
// the manual apply route and the auto-match route so allocation, status flips,
// and balance recomputes stay identical.
//
// IMPORTANT: this updates WEBSITE balances only. QuickBooks still shows the credit
// unapplied until it is applied inside QB — the next Step 2 (Invoice History,
// All Dates) import re-syncs open balances from QB and will revert any application
// that wasn't mirrored there. The UI must keep saying this.

import { db } from '@/db'
import { qbInvoices, qbUnappliedCredits } from '@/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface CreditAllocation {
  invoiceId: string
  invoiceNum: string
  invoiceDate: string
  amountCents: number
}

export interface ApplicableCredit {
  id: string
  facilityId: string
  openBalanceCents: number
  appliedCents: number
  appliedDetail: CreditAllocation[] | null
}

/**
 * Allocates the credit's remaining balance across the given invoices oldest-first,
 * decrementing each invoice's open balance (status → 'paid' when zeroed, 'partial'
 * otherwise) and recording the allocations on the credit row.
 * Throws on scope violations — callers run this inside a transaction so a throw
 * rolls everything back.
 */
export async function applyCreditToInvoices(
  tx: Tx,
  credit: ApplicableCredit,
  invoiceIds: string[],
  userId: string,
): Promise<{ allocations: CreditAllocation[]; appliedCents: number }> {
  const remaining = credit.openBalanceCents - credit.appliedCents
  if (remaining <= 0) throw new Error('Credit is already fully applied')
  if (invoiceIds.length === 0) throw new Error('No invoices selected')

  const invoices = await tx
    .select({
      id: qbInvoices.id,
      invoiceNum: qbInvoices.invoiceNum,
      invoiceDate: qbInvoices.invoiceDate,
      openBalanceCents: qbInvoices.openBalanceCents,
    })
    .from(qbInvoices)
    .where(and(
      inArray(qbInvoices.id, invoiceIds),
      eq(qbInvoices.facilityId, credit.facilityId),
      eq(qbInvoices.isDemo, false),
    ))

  if (invoices.length !== invoiceIds.length) {
    throw new Error('One or more invoices are not in this credit’s facility')
  }

  invoices.sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate))

  let left = remaining
  const allocations: CreditAllocation[] = []
  for (const inv of invoices) {
    if (left <= 0) break
    if (inv.openBalanceCents <= 0) continue
    const take = Math.min(left, inv.openBalanceCents)
    const newOpen = inv.openBalanceCents - take
    await tx
      .update(qbInvoices)
      .set({
        openBalanceCents: newOpen,
        status: newOpen === 0 ? 'paid' : 'partial',
        updatedAt: new Date(),
      })
      .where(eq(qbInvoices.id, inv.id))
    allocations.push({
      invoiceId: inv.id,
      invoiceNum: inv.invoiceNum,
      invoiceDate: inv.invoiceDate,
      amountCents: take,
    })
    left -= take
  }

  if (allocations.length === 0) {
    throw new Error('Selected invoices have no open balance to apply against')
  }

  const appliedNow = remaining - left
  await tx
    .update(qbUnappliedCredits)
    .set({
      appliedCents: credit.appliedCents + appliedNow,
      appliedAt: new Date(),
      appliedBy: userId,
      appliedDetail: [...(credit.appliedDetail ?? []), ...allocations],
    })
    .where(eq(qbUnappliedCredits.id, credit.id))

  return { allocations, appliedCents: appliedNow }
}

/** Recompute facility + resident outstanding balances from invoice open balances. */
export async function recomputeFacilityBalances(tx: Tx, facilityIds: string[]): Promise<void> {
  for (const fid of Array.from(new Set(facilityIds))) {
    await tx.execute(sql`
      UPDATE facilities f
      SET qb_outstanding_balance_cents = COALESCE((
        SELECT SUM(open_balance_cents) FROM qb_invoices WHERE facility_id = f.id AND is_demo = false
      ), 0)
      WHERE f.id = ${fid}
    `)
    await tx.execute(sql`
      UPDATE residents r
      SET qb_outstanding_balance_cents = COALESCE((
        SELECT SUM(open_balance_cents) FROM qb_invoices WHERE resident_id = r.id AND is_demo = false
      ), 0)
      WHERE r.facility_id = ${fid}
    `)
  }
}
