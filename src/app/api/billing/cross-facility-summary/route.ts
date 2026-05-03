import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v)
  if (typeof v === 'bigint') return Number(v)
  return 0
}

const getCachedCrossFacilitySummary = unstable_cache(
  async () => {
    const [outstandingRows, collectedRows, invoicedRows, overdueRows, revShareRows, netRows] =
      await Promise.all([
        db.execute(sql`
          SELECT COALESCE(SUM(qb_outstanding_balance_cents), 0)::bigint AS total
          FROM facilities WHERE active = true
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total
          FROM qb_payments
          WHERE payment_date >= date_trunc('month', CURRENT_DATE)
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total
          FROM qb_invoices
          WHERE invoice_date >= date_trunc('month', CURRENT_DATE)
        `),
        db.execute(sql`
          SELECT COUNT(*)::int AS total
          FROM facilities f
          WHERE f.active = true
            AND f.qb_outstanding_balance_cents > 0
            AND NOT EXISTS (
              SELECT 1 FROM qb_invoices i
              WHERE i.facility_id = f.id
                AND i.invoice_date >= (CURRENT_DATE - INTERVAL '30 days')
            )
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(rev_share_amount_cents), 0)::bigint AS total
          FROM qb_payments
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(senior_stylist_amount_cents), 0)::bigint AS total
          FROM qb_payments
        `),
      ])

    return {
      totalOutstandingCents: toNum((outstandingRows[0] as { total?: unknown } | undefined)?.total),
      collectedThisMonthCents: toNum((collectedRows[0] as { total?: unknown } | undefined)?.total),
      invoicedThisMonthCents: toNum((invoicedRows[0] as { total?: unknown } | undefined)?.total),
      facilitiesOverdueCount: toNum((overdueRows[0] as { total?: unknown } | undefined)?.total),
      totalRevShareCents: toNum((revShareRows[0] as { total?: unknown } | undefined)?.total),
      totalNetCents: toNum((netRows[0] as { total?: unknown } | undefined)?.total),
    }
  },
  ['cross-facility-summary'],
  { revalidate: 120, tags: ['billing'] },
)

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!isMaster) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const data = await getCachedCrossFacilitySummary()
    return Response.json({ data })
  } catch (err) {
    console.error('[billing/cross-facility-summary] DB error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
