import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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
    const [outstandingRows, collectedRows, invoicedRows, overdueRows] = await Promise.all([
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
    ])

    const toNum = (v: unknown): number => {
      if (typeof v === 'number') return v
      if (typeof v === 'string') return Number(v)
      if (typeof v === 'bigint') return Number(v)
      return 0
    }

    const totalOutstandingCents = toNum((outstandingRows[0] as { total?: unknown } | undefined)?.total)
    const collectedThisMonthCents = toNum((collectedRows[0] as { total?: unknown } | undefined)?.total)
    const invoicedThisMonthCents = toNum((invoicedRows[0] as { total?: unknown } | undefined)?.total)
    const facilitiesOverdueCount = toNum((overdueRows[0] as { total?: unknown } | undefined)?.total)

    return Response.json({
      data: {
        totalOutstandingCents,
        collectedThisMonthCents,
        invoicedThisMonthCents,
        facilitiesOverdueCount,
      },
    })
  } catch (err) {
    console.error('[billing/cross-facility-summary] DB error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
