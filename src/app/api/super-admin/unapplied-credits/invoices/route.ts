// Open invoices a given unapplied credit can be applied against — the credit's
// resident's invoices first, then the rest of the facility. Master admin only.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { qbInvoices, qbUnappliedCredits, residents } from '@/db/schema'
import { and, asc, eq, gt } from 'drizzle-orm'
import { NextRequest } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!superAdminEmail || user.email !== superAdminEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const creditId = req.nextUrl.searchParams.get('creditId') ?? ''
    if (!UUID_RE.test(creditId)) {
      return Response.json({ error: 'Invalid creditId' }, { status: 400 })
    }

    const credit = await db.query.qbUnappliedCredits.findFirst({
      where: eq(qbUnappliedCredits.id, creditId),
    })
    if (!credit) return Response.json({ error: 'Credit not found' }, { status: 404 })

    const rows = await db
      .select({
        id: qbInvoices.id,
        invoiceNum: qbInvoices.invoiceNum,
        invoiceDate: qbInvoices.invoiceDate,
        amountCents: qbInvoices.amountCents,
        openBalanceCents: qbInvoices.openBalanceCents,
        residentId: qbInvoices.residentId,
        residentName: residents.name,
      })
      .from(qbInvoices)
      .leftJoin(residents, eq(qbInvoices.residentId, residents.id))
      .where(and(
        eq(qbInvoices.facilityId, credit.facilityId),
        eq(qbInvoices.isDemo, false),
        gt(qbInvoices.openBalanceCents, 0),
      ))
      .orderBy(asc(qbInvoices.invoiceDate))
      .limit(300)

    const invoices = rows.map((r) => ({
      ...r,
      isResidentMatch: !!credit.residentId && r.residentId === credit.residentId,
    }))
    // Resident's own invoices first, then the rest — both oldest-first
    invoices.sort((a, b) =>
      a.isResidentMatch === b.isResidentMatch
        ? a.invoiceDate.localeCompare(b.invoiceDate)
        : a.isResidentMatch ? -1 : 1,
    )

    return Response.json({
      data: {
        remainingCents: credit.openBalanceCents - credit.appliedCents,
        invoices,
      },
    })
  } catch (err) {
    console.error('[unapplied-credits/invoices] error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
