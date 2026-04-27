import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbInvoices, qbPayments } from '@/db/schema'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { NextRequest } from 'next/server'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const getBillingSummaryData = unstable_cache(
  async (facilityId: string, from: string, to: string) => {
    const invoiceWhere = and(
      eq(qbInvoices.facilityId, facilityId),
      gte(qbInvoices.invoiceDate, from),
      lte(qbInvoices.invoiceDate, to)
    )
    const paymentWhere = and(
      eq(qbPayments.facilityId, facilityId),
      gte(qbPayments.paymentDate, from),
      lte(qbPayments.paymentDate, to)
    )

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
          revSharePercentage: true,
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
        limit: 500,
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
          revShareAmountCents: true,
          revShareType: true,
          seniorStylistAmountCents: true,
        },
        orderBy: [desc(qbPayments.paymentDate)],
        limit: 200,
      }),
    ])

    return { facility: facility ?? null, residents: residentList, invoices, payments }
  },
  ['billing-summary'],
  { revalidate: 120, tags: ['billing'] }
)

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

  // Default to current month when no params provided — protects against unbounded
  // historical fetches. Client always sends explicit params for its period selector.
  const today = new Date()
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .split('T')[0]
  const defaultTo = today.toISOString().split('T')[0]

  const fromParam = req.nextUrl.searchParams.get('from') ?? defaultFrom
  const toParam = req.nextUrl.searchParams.get('to') ?? defaultTo

  if (!ISO_DATE.test(fromParam) || !ISO_DATE.test(toParam)) {
    return Response.json({ error: 'Invalid date range' }, { status: 400 })
  }

  try {
    const data = await getBillingSummaryData(facilityId, fromParam, toParam)
    if (!data.facility) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ data })
  } catch (err) {
    console.error('[billing/summary] DB error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
