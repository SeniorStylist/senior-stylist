import { unstable_cache } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v)
  if (typeof v === 'bigint') return Number(v)
  return 0
}

// `from`/`to` are part of the cache key (unstable_cache serializes args), so each
// selected period caches its own snapshot.
const getCachedCrossFacilitySummary = unstable_cache(
  async (from: string, to: string) => {
    const [outstandingRows, rangeOutstandingRows, collectedRows, invoicedRows, overdueRows, revShareRows, netRows] =
      await Promise.all([
        db.execute(sql`
          SELECT COALESCE(SUM(qb_outstanding_balance_cents), 0)::bigint AS total
          FROM facilities WHERE active = true
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(open_balance_cents), 0)::bigint AS total
          FROM qb_invoices
          WHERE is_demo = false AND invoice_date >= ${from} AND invoice_date <= ${to}
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total
          FROM qb_payments
          WHERE is_demo = false AND payment_date >= ${from} AND payment_date <= ${to}
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(amount_cents), 0)::bigint AS total
          FROM qb_invoices
          WHERE is_demo = false AND invoice_date >= ${from} AND invoice_date <= ${to}
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
          FROM qb_payments WHERE is_demo = false
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(senior_stylist_amount_cents), 0)::bigint AS total
          FROM qb_payments WHERE is_demo = false
        `),
      ])

    // Unapplied credits — separate query so a missing table/column (Step 5 hasn't
    // run yet / apply migration pending) degrades to 0 instead of failing the page.
    let totalUnappliedCents = 0
    try {
      const r = await db.execute(sql`
        SELECT COALESCE(SUM(open_balance_cents - applied_cents), 0)::bigint AS total
        FROM qb_unapplied_credits
      `)
      totalUnappliedCents = toNum((r[0] as { total?: unknown } | undefined)?.total)
    } catch {
      try {
        const r = await db.execute(sql`
          SELECT COALESCE(SUM(open_balance_cents), 0)::bigint AS total
          FROM qb_unapplied_credits
        `)
        totalUnappliedCents = toNum((r[0] as { total?: unknown } | undefined)?.total)
      } catch { /* table doesn't exist yet */ }
    }

    return {
      totalOutstandingCents: toNum((outstandingRows[0] as { total?: unknown } | undefined)?.total),
      rangeOutstandingCents: toNum((rangeOutstandingRows[0] as { total?: unknown } | undefined)?.total),
      collectedCents: toNum((collectedRows[0] as { total?: unknown } | undefined)?.total),
      invoicedCents: toNum((invoicedRows[0] as { total?: unknown } | undefined)?.total),
      facilitiesOverdueCount: toNum((overdueRows[0] as { total?: unknown } | undefined)?.total),
      totalRevShareCents: toNum((revShareRows[0] as { total?: unknown } | undefined)?.total),
      totalNetCents: toNum((netRows[0] as { total?: unknown } | undefined)?.total),
      totalUnappliedCents,
    }
  },
  ['cross-facility-summary'],
  { revalidate: 120, tags: ['billing'] },
)

export async function GET(req: NextRequest) {
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

  // Default to current month when no params provided
  const today = new Date()
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .split('T')[0]
  const defaultTo = today.toISOString().split('T')[0]

  const from = req.nextUrl.searchParams.get('from') ?? defaultFrom
  const to = req.nextUrl.searchParams.get('to') ?? defaultTo
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return Response.json({ error: 'Invalid date range' }, { status: 400 })
  }

  try {
    const data = await getCachedCrossFacilitySummary(from, to)
    return Response.json({ data })
  } catch (err) {
    console.error('[billing/cross-facility-summary] DB error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
