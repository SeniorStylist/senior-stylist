import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const typeSchema = z.enum(['outstanding', 'collected', 'invoiced', 'overdue'])

type DetailRow = {
  facilityId: string
  facilityCode: string | null
  name: string
  valueCents: number
  daysOverdue?: number | null
}

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

  const parsed = typeSchema.safeParse(req.nextUrl.searchParams.get('type'))
  if (!parsed.success) {
    return Response.json({ error: 'Invalid type' }, { status: 400 })
  }
  const type = parsed.data

  const toNum = (v: unknown): number => {
    if (typeof v === 'number') return v
    if (typeof v === 'string') return Number(v)
    if (typeof v === 'bigint') return Number(v)
    return 0
  }
  const toNullableInt = (v: unknown): number | null => {
    if (v == null) return null
    const n = toNum(v)
    return Number.isFinite(n) ? n : null
  }

  try {
    let rows: Iterable<Record<string, unknown>>
    if (type === 'outstanding') {
      rows = await db.execute(sql`
        SELECT id, name, facility_code, qb_outstanding_balance_cents AS value_cents
        FROM facilities
        WHERE active = true AND qb_outstanding_balance_cents > 0
        ORDER BY qb_outstanding_balance_cents DESC
      `)
    } else if (type === 'collected') {
      rows = await db.execute(sql`
        SELECT f.id, f.name, f.facility_code,
               COALESCE(SUM(p.amount_cents), 0)::bigint AS value_cents
        FROM facilities f
        LEFT JOIN qb_payments p
          ON p.facility_id = f.id
         AND p.payment_date >= date_trunc('month', CURRENT_DATE)
        WHERE f.active = true
        GROUP BY f.id, f.name, f.facility_code
        ORDER BY value_cents DESC
      `)
    } else if (type === 'invoiced') {
      rows = await db.execute(sql`
        SELECT f.id, f.name, f.facility_code,
               COALESCE(SUM(i.amount_cents), 0)::bigint AS value_cents
        FROM facilities f
        LEFT JOIN qb_invoices i
          ON i.facility_id = f.id
         AND i.invoice_date >= date_trunc('month', CURRENT_DATE)
        WHERE f.active = true
        GROUP BY f.id, f.name, f.facility_code
        ORDER BY value_cents DESC
      `)
    } else {
      rows = await db.execute(sql`
        SELECT f.id, f.name, f.facility_code,
               f.qb_outstanding_balance_cents AS value_cents,
               CASE WHEN MAX(i.invoice_date) IS NULL
                    THEN NULL
                    ELSE (CURRENT_DATE - MAX(i.invoice_date))::int
               END AS days_overdue
        FROM facilities f
        LEFT JOIN qb_invoices i ON i.facility_id = f.id
        WHERE f.active = true AND f.qb_outstanding_balance_cents > 0
        GROUP BY f.id, f.name, f.facility_code, f.qb_outstanding_balance_cents
        HAVING MAX(i.invoice_date) IS NULL
            OR MAX(i.invoice_date) < (CURRENT_DATE - INTERVAL '30 days')
        ORDER BY days_overdue DESC NULLS FIRST
      `)
    }

    const data: DetailRow[] = []
    for (const row of rows) {
      const r = row as {
        id: string
        name: string
        facility_code: string | null
        value_cents: unknown
        days_overdue?: unknown
      }
      const entry: DetailRow = {
        facilityId: r.id,
        name: r.name ?? '',
        facilityCode: r.facility_code ?? null,
        valueCents: toNum(r.value_cents),
      }
      if (type === 'overdue') {
        entry.daysOverdue = toNullableInt(r.days_overdue)
      }
      data.push(entry)
    }

    return Response.json({ data })
  } catch (err) {
    console.error('[billing/cross-facility-detail] DB error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
