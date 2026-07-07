import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbInvoices, qbPayments } from '@/db/schema'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { isTutorialModeActive } from '@/lib/help/tutorial-request'
import { NextRequest } from 'next/server'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// `demo` is part of the cache key (last arg) so a tour's demo snapshot is cached
// separately from the real billing data — they never bleed into each other.
const getBillingSummaryData = unstable_cache(
  async (facilityId: string, from: string, to: string, demo: boolean) => {
    const invoiceWhere = and(
      eq(qbInvoices.facilityId, facilityId),
      eq(qbInvoices.isDemo, demo),
      gte(qbInvoices.invoiceDate, from),
      lte(qbInvoices.invoiceDate, to)
    )
    const paymentWhere = and(
      eq(qbPayments.facilityId, facilityId),
      eq(qbPayments.isDemo, demo),
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
          // Phase 12F — facility tz reaches BillingFacility for tz-aware display
          timezone: true,
          qbAccessToken: true,
          qbRefreshToken: true,
          qbInvoicesLastSyncedAt: true,
        },
      }),
      db.query.residents.findMany({
        where: and(eq(residents.facilityId, facilityId), eq(residents.active, true), eq(residents.isDemo, demo)),
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
          checkImageUrl: true,
        },
        orderBy: [desc(qbPayments.paymentDate)],
        limit: 200,
      }),
    ])

    // Unapplied credits — remaining = open − site-applied. Separate query with
    // fallbacks so a missing table/column (Step 5 not run / 0009 not applied yet)
    // degrades to 0 instead of failing the whole billing page.
    let facilityUnappliedCents = 0
    try {
      const r = await db.execute(sql`
        SELECT COALESCE(SUM(open_balance_cents - applied_cents), 0)::bigint AS total
        FROM qb_unapplied_credits WHERE facility_id = ${facilityId}
      `)
      facilityUnappliedCents = Number((r as unknown as Array<{ total: unknown }>)[0]?.total ?? 0) || 0
    } catch {
      try {
        const r = await db.execute(sql`
          SELECT COALESCE(SUM(open_balance_cents), 0)::bigint AS total
          FROM qb_unapplied_credits WHERE facility_id = ${facilityId}
        `)
        facilityUnappliedCents = Number((r as unknown as Array<{ total: unknown }>)[0]?.total ?? 0) || 0
      } catch { /* table doesn't exist yet */ }
    }

    const facilityClean = facility
      ? (() => {
          const { qbAccessToken, qbRefreshToken, ...rest } = facility
          return {
            ...rest,
            hasQuickBooks: !!(qbAccessToken && qbRefreshToken),
          }
        })()
      : null

    // Storage path stays server-side — clients get a boolean and fetch a
    // signed URL from /api/billing/check-image/[paymentId] on demand.
    const paymentsClean = payments.map(({ checkImageUrl, ...p }) => ({
      ...p,
      hasCheckImage: !!checkImageUrl,
    }))

    // Phase 16 G10 — invoice aging over ALL open balances (independent of the
    // date-range filter above). ONE query; FILTER buckets by invoice age.
    let agingBuckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 }
    try {
      const r = await db.execute(sql`
        SELECT
          COALESCE(SUM(open_balance_cents) FILTER (WHERE CURRENT_DATE - invoice_date <= 30), 0)::bigint AS b0_30,
          COALESCE(SUM(open_balance_cents) FILTER (WHERE CURRENT_DATE - invoice_date BETWEEN 31 AND 60), 0)::bigint AS b31_60,
          COALESCE(SUM(open_balance_cents) FILTER (WHERE CURRENT_DATE - invoice_date BETWEEN 61 AND 90), 0)::bigint AS b61_90,
          COALESCE(SUM(open_balance_cents) FILTER (WHERE CURRENT_DATE - invoice_date > 90), 0)::bigint AS b90plus
        FROM qb_invoices
        WHERE facility_id = ${facilityId} AND status != 'paid' AND open_balance_cents > 0 AND is_demo = ${demo}
      `)
      const row = (r as unknown as Array<Record<string, unknown>>)[0]
      if (row) {
        agingBuckets = {
          b0_30: Number(row.b0_30 ?? 0) || 0,
          b31_60: Number(row.b31_60 ?? 0) || 0,
          b61_90: Number(row.b61_90 ?? 0) || 0,
          b90plus: Number(row.b90plus ?? 0) || 0,
        }
      }
    } catch { /* aging is a nice-to-have — never fail the billing page */ }

    return { facility: facilityClean, residents: residentList, invoices, payments: paymentsClean, facilityUnappliedCents, agingBuckets }
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
    // Bookkeepers are cross-facility by role; everyone else is scoped to their own
    if (fu.facilityId !== facilityId && fu.role !== 'bookkeeper') {
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
    const tutorialMode = await isTutorialModeActive()
    const data = await getBillingSummaryData(facilityId, fromParam, toParam, tutorialMode)
    if (!data.facility) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ data })
  } catch (err) {
    console.error('[billing/summary] DB error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
