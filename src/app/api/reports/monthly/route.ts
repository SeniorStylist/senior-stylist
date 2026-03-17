import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings } from '@/db/schema'
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

    const totalRevenueCents = rows.reduce(
      (sum, b) => sum + (b.priceCents ?? b.service.priceCents),
      0
    )
    const totalAppointments = rows.length

    // Revenue by service
    const serviceMap = new Map<string, { name: string; count: number; revenueCents: number }>()
    for (const b of rows) {
      const existing = serviceMap.get(b.service.id)
      const price = b.priceCents ?? b.service.priceCents
      if (existing) {
        existing.count++
        existing.revenueCents += price
      } else {
        serviceMap.set(b.service.id, { name: b.service.name, count: 1, revenueCents: price })
      }
    }
    const byService = Array.from(serviceMap.values()).sort(
      (a, b) => b.revenueCents - a.revenueCents
    )

    // Revenue by stylist
    const stylistMap = new Map<string, { name: string; count: number; revenueCents: number }>()
    for (const b of rows) {
      const existing = stylistMap.get(b.stylist.id)
      const price = b.priceCents ?? b.service.priceCents
      if (existing) {
        existing.count++
        existing.revenueCents += price
      } else {
        stylistMap.set(b.stylist.id, { name: b.stylist.name, count: 1, revenueCents: price })
      }
    }
    const byStylist = Array.from(stylistMap.values()).sort(
      (a, b) => b.revenueCents - a.revenueCents
    )

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
      service: b.service.name,
      stylist: b.stylist.name,
      priceCents: b.priceCents ?? b.service.priceCents,
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
      },
    })
  } catch (err) {
    console.error('GET /api/reports/monthly error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
