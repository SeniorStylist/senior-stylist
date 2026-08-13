import { db } from '@/db'
import { facilities, qbInvoices, residents } from '@/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import { requirePortalAuth } from '@/lib/portal-auth'
import { getPortalLang } from '@/lib/portal-i18n-server'
import { platformStripeKey, platformPublishableKey } from '@/lib/payments/stripe-client'
import { BillingClient } from './billing-client'

export const dynamic = 'force-dynamic'

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ facilityCode: string }>
  searchParams: Promise<{ residentId?: string; payment?: string; gift?: string }>
}) {
  const { facilityCode } = await params
  const { residentId: searchResidentId, payment, gift } = await searchParams
  const decoded = decodeURIComponent(facilityCode)
  const { residentsAtFacility } = await requirePortalAuth(decoded)
  const lang = await getPortalLang()
  const selected =
    residentsAtFacility.find((r) => r.residentId === searchResidentId) ?? residentsAtFacility[0]

  const [residentRow, facilityRow, invoices, creditRows] = await Promise.all([
    db.query.residents.findFirst({
      where: eq(residents.id, selected.residentId),
      columns: { id: true, name: true, qbOutstandingBalanceCents: true, autopayEnabled: true },
    }),
    db.query.facilities.findFirst({
      where: eq(facilities.id, selected.facilityId),
      columns: { id: true, contactEmail: true, phone: true },
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
      // P53 — is_demo filter: families saw seed/demo invoices in the list + statement
      .where(and(eq(qbInvoices.residentId, selected.residentId), eq(qbInvoices.isDemo, false)))
      .orderBy(desc(qbInvoices.invoiceDate))
      .limit(24),
    // P53 — visible salon credit: prepay/gift money used to be invisible here,
    // so families paid the full balance again. Same SUM the autopay GET uses.
    db
      .execute(
        sql`SELECT COALESCE(SUM(open_balance_cents - applied_cents), 0) AS c
            FROM qb_unapplied_credits
            WHERE resident_id = ${selected.residentId} AND (open_balance_cents - applied_cents) > 0`,
      )
      .then((rows) => Number((rows as unknown as Array<{ c: number | string }>)[0]?.c ?? 0) || 0)
      .catch(() => 0),
  ])

  const outstanding = residentRow?.qbOutstandingBalanceCents ?? 0
  // P53 — the card/checkout stack runs on the PLATFORM keys (welcome-page
  // pattern); the facility key is legacy and no longer gates anything here.
  const stripeAvailable = !!platformStripeKey()
  const cardsConfigured = !!platformStripeKey() && !!platformPublishableKey()

  return (
    <BillingClient
      facilityCode={decoded}
      lang={lang}
      residentId={selected.residentId}
      residentName={selected.residentName}
      outstandingCents={outstanding}
      autopayEnabled={residentRow?.autopayEnabled ?? false}
      stripeAvailable={stripeAvailable}
      cardsConfigured={cardsConfigured}
      availableCreditCents={creditRows}
      paymentSuccess={payment === 'success'}
      giftSuccess={gift === 'success'}
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
