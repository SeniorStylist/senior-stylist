import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbInvoices, qbPayments } from '@/db/schema'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { NextRequest } from 'next/server'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ facilityId: string }> }
) {
  const { facilityId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  if (!isMaster) {
    const fu = await getUserFacility(user.id)
    if (!fu || !canAccessBilling(fu.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (fu.facilityId !== facilityId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const fromParam = req.nextUrl.searchParams.get('from')
  const toParam = req.nextUrl.searchParams.get('to')
  const hasRange = !!(fromParam && toParam)
  if (hasRange && (!ISO_DATE.test(fromParam!) || !ISO_DATE.test(toParam!))) {
    return Response.json({ error: 'Invalid date range' }, { status: 400 })
  }

  const invoiceWhere = hasRange
    ? and(
        eq(qbInvoices.facilityId, facilityId),
        gte(qbInvoices.invoiceDate, fromParam!),
        lte(qbInvoices.invoiceDate, toParam!)
      )
    : eq(qbInvoices.facilityId, facilityId)
  const paymentWhere = hasRange
    ? and(
        eq(qbPayments.facilityId, facilityId),
        gte(qbPayments.paymentDate, fromParam!),
        lte(qbPayments.paymentDate, toParam!)
      )
    : eq(qbPayments.facilityId, facilityId)

  try {
    const [facility, residentList, invoices, payments] = await Promise.all([
      db.query.facilities.findFirst({
        where: eq(facilities.id, facilityId),
        columns: {
          id: true,
          name: true,
          facilityCode: true,
          paymentType: true,
          qbOutstandingBalanceCents: true,
          qbRevShareType: true,
          contactEmail: true,
          address: true,
        },
      }),
      db.query.residents.findMany({
        where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
        columns: {
          id: true,
          name: true,
          roomNumber: true,
          residentPaymentType: true,
          qbOutstandingBalanceCents: true,
          qbCustomerId: true,
          poaEmail: true,
        },
        orderBy: (t, { asc }) => [asc(t.name)],
      }),
      db.query.qbInvoices.findMany({
        where: invoiceWhere,
        orderBy: [desc(qbInvoices.invoiceDate)],
      }),
      db.query.qbPayments.findMany({
        where: paymentWhere,
        columns: {
          id: true,
          facilityId: true,
          residentId: true,
          qbCustomerId: true,
          checkNum: true,
          checkDate: true,
          paymentDate: true,
          amountCents: true,
          memo: true,
          invoiceRef: true,
          paymentType: true,
          recordedVia: true,
          residentBreakdown: true,
          reconciliationStatus: true,
          reconciledAt: true,
          reconciliationNotes: true,
          reconciliationLines: true,
        },
        orderBy: [desc(qbPayments.paymentDate)],
      }),
    ])

    if (!facility) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({
      data: {
        facility,
        residents: residentList,
        invoices,
        payments,
      },
    })
  } catch (err) {
    console.error('[billing/summary] DB error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
