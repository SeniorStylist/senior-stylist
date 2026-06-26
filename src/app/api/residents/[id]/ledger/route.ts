import { NextRequest } from 'next/server'
import { db } from '@/db'
import { residents, qbInvoices, qbPayments } from '@/db/schema'
import { and, eq, desc, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'

export const dynamic = 'force-dynamic'

// Per-resident account ledger: invoices (charges) + payments (reductions)
// interleaved chronologically with a running balance, plus available
// (unapplied) credit. Facility-side, gated to canAccessBilling.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: residentId } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, residentId),
      columns: { id: true, name: true, facilityId: true, qbOutstandingBalanceCents: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    // Auth scope: master → any; bookkeeper → any (cross-facility by role); admin/
    // super_admin → own facility only. facility_staff/stylist/viewer → forbidden.
    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu || !canAccessBilling(fu.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (fu.role !== 'bookkeeper' && fu.facilityId !== resident.facilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const facilityId = resident.facilityId

    const [invoices, payments] = await Promise.all([
      db.query.qbInvoices.findMany({
        where: and(eq(qbInvoices.facilityId, facilityId), eq(qbInvoices.residentId, residentId), eq(qbInvoices.isDemo, false)),
        columns: { id: true, invoiceNum: true, invoiceDate: true, amountCents: true, openBalanceCents: true, status: true },
        orderBy: [desc(qbInvoices.invoiceDate)],
        limit: 500,
      }),
      db.query.qbPayments.findMany({
        where: and(eq(qbPayments.facilityId, facilityId), eq(qbPayments.residentId, residentId), eq(qbPayments.isDemo, false)),
        columns: { id: true, checkNum: true, paymentDate: true, amountCents: true, memo: true, paymentMethod: true, paymentType: true },
        orderBy: [desc(qbPayments.paymentDate)],
        limit: 500,
      }),
    ])

    // Unapplied credits — remaining = open_balance_cents - applied_cents.
    // Graceful fallback for pre-migration schemas (mirrors billing-summary).
    let credits: { id: string; txnDate: string; num: string | null; remainingCents: number; amountCents: number }[] = []
    try {
      const rows = (await db.execute(sql`
        SELECT id, txn_date, num, amount_cents, (open_balance_cents - applied_cents) AS remaining_cents
        FROM qb_unapplied_credits
        WHERE facility_id = ${facilityId} AND resident_id = ${residentId}
          AND (open_balance_cents - applied_cents) > 0
        ORDER BY txn_date DESC
        LIMIT 200
      `)) as unknown as Array<{ id: string; txn_date: string; num: string | null; amount_cents: number | string; remaining_cents: number | string }>
      credits = rows.map((r) => ({
        id: r.id,
        txnDate: String(r.txn_date),
        num: r.num,
        amountCents: Number(r.amount_cents) || 0,
        remainingCents: Number(r.remaining_cents) || 0,
      }))
    } catch {
      credits = []
    }

    // Build a chronological ledger (oldest first) with a running owed balance.
    type Entry = {
      id: string
      date: string
      kind: 'invoice' | 'payment'
      label: string
      detail: string | null
      chargeCents: number
      paymentCents: number
    }
    const entries: Entry[] = [
      ...invoices.map((i): Entry => ({
        id: i.id,
        date: String(i.invoiceDate),
        kind: 'invoice',
        label: `Invoice ${i.invoiceNum}`,
        detail: i.status === 'paid' ? 'Paid' : i.status === 'partial' ? 'Partially paid' : 'Open',
        chargeCents: i.amountCents,
        paymentCents: 0,
      })),
      ...payments.map((p): Entry => ({
        id: p.id,
        date: String(p.paymentDate),
        kind: 'payment',
        label: p.checkNum ? `Payment — check #${p.checkNum}` : 'Payment',
        detail: p.paymentMethod || p.paymentType || p.memo || null,
        chargeCents: 0,
        paymentCents: p.amountCents,
      })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'invoice' ? -1 : 1))

    let running = 0
    const withBalance = entries.map((e) => {
      running += e.chargeCents - e.paymentCents
      return { ...e, balanceCents: running }
    })

    // Open invoices (for the credit-apply picker) — newest-relevant first.
    const openInvoices = invoices
      .filter((i) => i.openBalanceCents > 0)
      .map((i) => ({ id: i.id, invoiceNum: i.invoiceNum, invoiceDate: String(i.invoiceDate), openBalanceCents: i.openBalanceCents }))

    const totalInvoicedCents = invoices.reduce((s, i) => s + i.amountCents, 0)
    const totalPaidCents = payments.reduce((s, p) => s + p.amountCents, 0)
    const availableCreditCents = credits.reduce((s, c) => s + c.remainingCents, 0)
    // Authoritative current balance is the denormalized resident figure; fall back
    // to the computed running balance when it's null.
    const currentBalanceCents = resident.qbOutstandingBalanceCents ?? running

    return Response.json({
      data: {
        resident: { id: resident.id, name: resident.name },
        summary: { currentBalanceCents, availableCreditCents, totalInvoicedCents, totalPaidCents },
        // newest first for display
        entries: withBalance.reverse(),
        credits,
        openInvoices,
      },
    })
  } catch (err) {
    console.error('GET /api/residents/[residentId]/ledger error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
