import { db } from '@/db'
import { facilities, qbInvoices, residents } from '@/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { requirePortalAuth } from '@/lib/portal-auth'
import { BillingClient } from './billing-client'

export const dynamic = 'force-dynamic'

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ facilityCode: string }>
  searchParams: Promise<{ residentId?: string; payment?: string }>
}) {
  const { facilityCode } = await params
  const { residentId: searchResidentId, payment } = await searchParams
  const decoded = decodeURIComponent(facilityCode)
  const { residentsAtFacility } = await requirePortalAuth(decoded)
  const selected =
    residentsAtFacility.find((r) => r.residentId === searchResidentId) ?? residentsAtFacility[0]

  const [residentRow, facilityRow, invoices] = await Promise.all([
    db.query.residents.findFirst({
      where: eq(residents.id, selected.residentId),
      columns: { id: true, name: true, qbOutstandingBalanceCents: true },
    }),
    db.query.facilities.findFirst({
      where: eq(facilities.id, selected.facilityId),
      columns: { id: true, stripeSecretKey: true, contactEmail: true, phone: true },
    }),
    db
      .select({
        id: qbInvoices.id,
        invoiceNum: qbInvoices.invoiceNum,
        invoiceDate: qbInvoices.invoiceDate,
        amountCents: qbInvoices.amountCents,
        openBalanceCents: qbInvoices.openBalanceCents,
        status: qbInvoices.status,
      })
      .from(qbInvoices)
      .where(and(eq(qbInvoices.residentId, selected.residentId)))
      .orderBy(desc(qbInvoices.invoiceDate))
      .limit(24),
  ])

  const outstanding = residentRow?.qbOutstandingBalanceCents ?? 0
  const stripeAvailable = !!(facilityRow?.stripeSecretKey || process.env.STRIPE_SECRET_KEY)

  return (
    <BillingClient
      facilityCode={decoded}
      residentId={selected.residentId}
      residentName={selected.residentName}
      outstandingCents={outstanding}
      stripeAvailable={stripeAvailable}
      paymentSuccess={payment === 'success'}
      facilityPhone={facilityRow?.phone ?? null}
      facilityEmail={facilityRow?.contactEmail ?? null}
      invoices={invoices.map((i) => ({
        id: i.id,
        invoiceNum: i.invoiceNum,
        invoiceDate: i.invoiceDate,
        amountCents: i.amountCents,
        openBalanceCents: i.openBalanceCents,
        status: i.status,
      }))}
    />
  )
}
