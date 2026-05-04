import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, eq, gte, lt, ne } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const monthParam = request.nextUrl.searchParams.get('month')
    let year: number
    let month: number // 0-based

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number)
      year = y
      month = m - 1
    } else {
      const now = new Date()
      year = now.getUTCFullYear()
      month = now.getUTCMonth()
    }

    const start = new Date(Date.UTC(year, month, 1))
    const end = new Date(Date.UTC(year, month + 1, 1))

    const rows = await db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.active, true),
        ne(bookings.status, 'cancelled'),
        ne(bookings.status, 'no_show'),
        gte(bookings.startTime, start),
        lt(bookings.startTime, end)
      ),
      with: {
        resident: true,
        stylist: true,
        service: true,
      },
      orderBy: (t, { asc }) => [asc(t.startTime)],
    })

    // price_cents only — never add tip_cents (tips go to stylist, not facility revenue)
    const totalRevenueCents = rows.reduce(
      (sum, b) => sum + (b.priceCents ?? b.service?.priceCents ?? 0),
      0
    )
    const totalAppointments = rows.length

    // Revenue by service
    const serviceMap = new Map<string, { name: string; count: number; revenueCents: number }>()
    for (const b of rows) {
      const key = b.service?.id ?? b.id
      const existing = serviceMap.get(key)
      const price = b.priceCents ?? b.service?.priceCents ?? 0
      if (existing) {
        existing.count++
        existing.revenueCents += price
      } else {
        serviceMap.set(key, { name: b.service?.name ?? b.rawServiceName ?? 'Unknown service', count: 1, revenueCents: price })
      }
    }
    const byService = Array.from(serviceMap.values()).sort(
      (a, b) => b.revenueCents - a.revenueCents
    )

    // Revenue by stylist (with commission)
    const allStylists = await db.query.stylists.findMany({
      where: and(eq(stylists.facilityId, facilityId), eq(stylists.active, true)),
    })
    const stylistCommissionMap = new Map(allStylists.map((s) => [s.id, s.commissionPercent]))

    const stylistMap = new Map<string, { name: string; count: number; revenueCents: number; commissionPercent: number }>()
    for (const b of rows) {
      const existing = stylistMap.get(b.stylist.id)
      const price = b.priceCents ?? b.service?.priceCents ?? 0
      const cp = stylistCommissionMap.get(b.stylist.id) ?? 0
      if (existing) {
        existing.count++
        existing.revenueCents += price
      } else {
        stylistMap.set(b.stylist.id, { name: b.stylist.name, count: 1, revenueCents: price, commissionPercent: cp })
      }
    }
    const byStylist = Array.from(stylistMap.values()).sort(
      (a, b) => b.revenueCents - a.revenueCents
    )

    // Commission summary
    const commissions = byStylist.map((s) => ({
      name: s.name,
      revenueCents: s.revenueCents,
      commissionPercent: s.commissionPercent,
      commissionCents: Math.round(s.revenueCents * s.commissionPercent / 100),
    }))

    // Busiest days (top 5)
    const dayMap = new Map<string, number>()
    for (const b of rows) {
      const dateStr = new Date(b.startTime).toISOString().split('T')[0]
      dayMap.set(dateStr, (dayMap.get(dateStr) ?? 0) + 1)
    }
    const busiestDays = Array.from(dayMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([date, count]) => ({ date, count }))

    // Full booking list
    const bookingList = rows.map((b) => ({
      id: b.id,
      startTime: b.startTime instanceof Date ? b.startTime.toISOString() : String(b.startTime),
      resident: b.resident.name,
      service: b.service?.name ?? b.rawServiceName ?? 'Unknown service',
      stylist: b.stylist.name,
      priceCents: b.priceCents ?? b.service?.priceCents ?? 0,
      status: b.status,
    }))

    return Response.json({
      data: {
        totalRevenueCents,
        totalAppointments,
        byService,
        byStylist,
        busiestDays,
        bookings: bookingList,
        commissions,
      },
    })
  } catch (err) {
    console.error('GET /api/reports/monthly error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
