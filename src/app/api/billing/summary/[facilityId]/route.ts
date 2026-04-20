import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbInvoices, qbPayments } from '@/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
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
    if (!fu || fu.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (fu.facilityId !== facilityId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

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
        where: eq(qbInvoices.facilityId, facilityId),
        orderBy: [desc(qbInvoices.invoiceDate)],
      }),
      db.query.qbPayments.findMany({
        where: eq(qbPayments.facilityId, facilityId),
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
