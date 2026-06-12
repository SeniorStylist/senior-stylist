// Monthly facility statement — month-by-month rollup of QB invoices, QB payments,
// and on-site completed services, so invoiced vs performed vs collected can be
// compared per month. No `?month=` → bucket list (cached 120s, 'billing' tag).
// `?month=YYYY-MM` → that month's invoices, payments, per-resident rollup, and
// services-by-day (lazy-loaded by the UI, uncached).

import { unstable_cache } from 'next/cache'
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

interface MonthBucket {
  month: string // YYYY-MM
  invoicedCents: number
  openCents: number
  invoiceCount: number
  paidCents: number
  paymentCount: number
  servicesCents: number
  serviceCount: number
}

const num = (v: unknown) => Number(v ?? 0) || 0

const getMonthlyBuckets = unstable_cache(
  async (facilityId: string): Promise<{ facilityName: string; buckets: MonthBucket[] } | null> => {
    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { id: true, name: true, timezone: true },
    })
    if (!facility) return null
    const tz = facility.timezone ?? 'America/New_York'

    const [invRows, payRows, svcRows] = await Promise.all([
      db.execute(sql`
        SELECT to_char(invoice_date, 'YYYY-MM') AS m, COUNT(*)::int AS n,
               COALESCE(SUM(amount_cents), 0)::bigint AS invoiced,
               COALESCE(SUM(open_balance_cents), 0)::bigint AS open
        FROM qb_invoices
        WHERE facility_id = ${facilityId} AND is_demo = false
        GROUP BY 1
      `),
      db.execute(sql`
        SELECT to_char(payment_date, 'YYYY-MM') AS m, COUNT(*)::int AS n,
               COALESCE(SUM(amount_cents), 0)::bigint AS paid
        FROM qb_payments
        WHERE facility_id = ${facilityId} AND is_demo = false
        GROUP BY 1
      `),
      // price_cents only — never add tip_cents
      db.execute(sql`
        SELECT to_char(start_time AT TIME ZONE ${tz}, 'YYYY-MM') AS m, COUNT(*)::int AS n,
               COALESCE(SUM(price_cents + COALESCE(addon_total_cents, 0)), 0)::bigint AS services
        FROM bookings
        WHERE facility_id = ${facilityId} AND status = 'completed'
          AND active = true AND is_demo = false
        GROUP BY 1
      `),
    ])

    const byMonth = new Map<string, MonthBucket>()
    const bucket = (m: string): MonthBucket => {
      let b = byMonth.get(m)
      if (!b) {
        b = { month: m, invoicedCents: 0, openCents: 0, invoiceCount: 0, paidCents: 0, paymentCount: 0, servicesCents: 0, serviceCount: 0 }
        byMonth.set(m, b)
      }
      return b
    }
    for (const r of invRows as unknown as Array<{ m: string; n: number; invoiced: unknown; open: unknown }>) {
      const b = bucket(r.m)
      b.invoiceCount = num(r.n)
      b.invoicedCents = num(r.invoiced)
      b.openCents = num(r.open)
    }
    for (const r of payRows as unknown as Array<{ m: string; n: number; paid: unknown }>) {
      const b = bucket(r.m)
      b.paymentCount = num(r.n)
      b.paidCents = num(r.paid)
    }
    for (const r of svcRows as unknown as Array<{ m: string; n: number; services: unknown }>) {
      const b = bucket(r.m)
      b.serviceCount = num(r.n)
      b.servicesCents = num(r.services)
    }

    const buckets = [...byMonth.values()].sort((a, b) => b.month.localeCompare(a.month))
    return { facilityName: facility.name, buckets }
  },
  ['billing-monthly'],
  { revalidate: 120, tags: ['billing'] }
)

async function getMonthDetail(facilityId: string, month: string) {
  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { id: true, timezone: true },
  })
  if (!facility) return null
  const tz = facility.timezone ?? 'America/New_York'
  const monthStart = `${month}-01`

  const [invoices, payments, svcByResident, invByResident, payByResident, svcByDay] = await Promise.all([
    db.execute(sql`
      SELECT i.id, i.invoice_num, i.invoice_date::text AS invoice_date, i.amount_cents,
             i.open_balance_cents, i.status, r.name AS resident_name
      FROM qb_invoices i
      LEFT JOIN residents r ON r.id = i.resident_id
      WHERE i.facility_id = ${facilityId} AND i.is_demo = false
        AND i.invoice_date >= ${monthStart}::date
        AND i.invoice_date < (${monthStart}::date + INTERVAL '1 month')
      ORDER BY i.invoice_date ASC, i.invoice_num ASC
      LIMIT 500
    `),
    db.execute(sql`
      SELECT p.id, p.payment_date::text AS payment_date, p.amount_cents, p.payment_method,
             p.check_num, LEFT(COALESCE(p.memo, ''), 120) AS memo, r.name AS resident_name
      FROM qb_payments p
      LEFT JOIN residents r ON r.id = p.resident_id
      WHERE p.facility_id = ${facilityId} AND p.is_demo = false
        AND p.payment_date >= ${monthStart}::date
        AND p.payment_date < (${monthStart}::date + INTERVAL '1 month')
      ORDER BY p.payment_date ASC
      LIMIT 500
    `),
    // price_cents only — never add tip_cents
    db.execute(sql`
      SELECT b.resident_id, r.name, r.room_number, COUNT(*)::int AS n,
             COALESCE(SUM(b.price_cents + COALESCE(b.addon_total_cents, 0)), 0)::bigint AS services
      FROM bookings b
      JOIN residents r ON r.id = b.resident_id
      WHERE b.facility_id = ${facilityId} AND b.status = 'completed'
        AND b.active = true AND b.is_demo = false
        AND to_char(b.start_time AT TIME ZONE ${tz}, 'YYYY-MM') = ${month}
      GROUP BY b.resident_id, r.name, r.room_number
    `),
    db.execute(sql`
      SELECT i.resident_id, r.name, r.room_number,
             COALESCE(SUM(i.amount_cents), 0)::bigint AS invoiced,
             COALESCE(SUM(i.open_balance_cents), 0)::bigint AS open
      FROM qb_invoices i
      JOIN residents r ON r.id = i.resident_id
      WHERE i.facility_id = ${facilityId} AND i.is_demo = false
        AND i.invoice_date >= ${monthStart}::date
        AND i.invoice_date < (${monthStart}::date + INTERVAL '1 month')
      GROUP BY i.resident_id, r.name, r.room_number
    `),
    db.execute(sql`
      SELECT p.resident_id, r.name, r.room_number,
             COALESCE(SUM(p.amount_cents), 0)::bigint AS paid
      FROM qb_payments p
      JOIN residents r ON r.id = p.resident_id
      WHERE p.facility_id = ${facilityId} AND p.is_demo = false
        AND p.payment_date >= ${monthStart}::date
        AND p.payment_date < (${monthStart}::date + INTERVAL '1 month')
      GROUP BY p.resident_id, r.name, r.room_number
    `),
    // price_cents only — never add tip_cents
    db.execute(sql`
      SELECT to_char(b.start_time AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n,
             COALESCE(SUM(b.price_cents + COALESCE(b.addon_total_cents, 0)), 0)::bigint AS total
      FROM bookings b
      WHERE b.facility_id = ${facilityId} AND b.status = 'completed'
        AND b.active = true AND b.is_demo = false
        AND to_char(b.start_time AT TIME ZONE ${tz}, 'YYYY-MM') = ${month}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
  ])

  // Merge the three per-resident rollups
  interface ResidentRow {
    residentId: string
    name: string
    roomNumber: string | null
    serviceCount: number
    servicesCents: number
    invoicedCents: number
    paidCents: number
    owedCents: number
  }
  const residents = new Map<string, ResidentRow>()
  const res = (id: string, name: string, room: string | null): ResidentRow => {
    let r = residents.get(id)
    if (!r) {
      r = { residentId: id, name, roomNumber: room, serviceCount: 0, servicesCents: 0, invoicedCents: 0, paidCents: 0, owedCents: 0 }
      residents.set(id, r)
    }
    return r
  }
  for (const r of svcByResident as unknown as Array<{ resident_id: string; name: string; room_number: string | null; n: number; services: unknown }>) {
    const row = res(r.resident_id, r.name, r.room_number)
    row.serviceCount = num(r.n)
    row.servicesCents = num(r.services)
  }
  for (const r of invByResident as unknown as Array<{ resident_id: string; name: string; room_number: string | null; invoiced: unknown; open: unknown }>) {
    const row = res(r.resident_id, r.name, r.room_number)
    row.invoicedCents = num(r.invoiced)
    row.owedCents = num(r.open)
  }
  for (const r of payByResident as unknown as Array<{ resident_id: string; name: string; room_number: string | null; paid: unknown }>) {
    const row = res(r.resident_id, r.name, r.room_number)
    row.paidCents = num(r.paid)
  }
  const residentRows = [...residents.values()].sort(
    (a, b) => b.owedCents - a.owedCents || a.name.localeCompare(b.name)
  )

  return {
    month,
    invoices: (invoices as unknown as Array<{ id: string; invoice_num: string; invoice_date: string; amount_cents: number; open_balance_cents: number; status: string; resident_name: string | null }>).map((i) => ({
      id: i.id,
      invoiceNum: i.invoice_num,
      invoiceDate: i.invoice_date,
      amountCents: num(i.amount_cents),
      openBalanceCents: num(i.open_balance_cents),
      status: i.status,
      residentName: i.resident_name,
    })),
    payments: (payments as unknown as Array<{ id: string; payment_date: string; amount_cents: number; payment_method: string | null; check_num: string | null; memo: string; resident_name: string | null }>).map((p) => ({
      id: p.id,
      paymentDate: p.payment_date,
      amountCents: num(p.amount_cents),
      paymentMethod: p.payment_method,
      checkNum: p.check_num,
      memo: p.memo || null,
      residentName: p.resident_name,
    })),
    residents: residentRows,
    servicesByDay: (svcByDay as unknown as Array<{ d: string; n: number; total: unknown }>).map((r) => ({
      date: r.d,
      count: num(r.n),
      totalCents: num(r.total),
    })),
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ facilityId: string }> }
) {
  const { facilityId } = await params
  if (!UUID_RE.test(facilityId)) {
    return Response.json({ error: 'Invalid facilityId' }, { status: 400 })
  }

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

  const month = req.nextUrl.searchParams.get('month')

  try {
    if (month) {
      if (!MONTH_RE.test(month)) {
        return Response.json({ error: 'Invalid month' }, { status: 400 })
      }
      const detail = await getMonthDetail(facilityId, month)
      if (!detail) return Response.json({ error: 'Not found' }, { status: 404 })
      return Response.json({ data: detail })
    }
    const data = await getMonthlyBuckets(facilityId)
    if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ data })
  } catch (err) {
    console.error('[billing/monthly] DB error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
