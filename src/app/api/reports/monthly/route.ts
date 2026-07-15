import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, stylists, facilities } from '@/db/schema'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { isTutorialModeActive } from '@/lib/help/tutorial-request'
import { dayRangeInTimezone, getLocalParts } from '@/lib/time'
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
    if (!canAccessBilling(facilityUser.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const { facilityId } = facilityUser

    const monthParam = request.nextUrl.searchParams.get('month')
    let year: number
    let month: number // 0-based

    // P32 — the month window and day bucketing are the FACILITY's calendar,
    // not UTC's (an 8pm-ET Jul-31 booking belongs to July, not August).
    const tzRow = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { timezone: true },
    })
    const facilityTz = tzRow?.timezone ?? 'America/New_York'

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number)
      year = y
      month = m - 1
    } else {
      const nowParts = getLocalParts(new Date(), facilityTz)
      year = nowParts.year
      month = nowParts.month - 1
    }

    const mm = String(month + 1).padStart(2, '0')
    const nextYear = month === 11 ? year + 1 : year
    const nextMm = String(month === 11 ? 1 : month + 2).padStart(2, '0')
    const start =
      dayRangeInTimezone(`${year}-${mm}-01`, facilityTz)?.start ?? new Date(Date.UTC(year, month, 1))
    const end =
      dayRangeInTimezone(`${nextYear}-${nextMm}-01`, facilityTz)?.start ?? new Date(Date.UTC(year, month + 1, 1))

    // is_demo filter — Phase 13: demo-only during a tour, real-only otherwise.
    // (Without this, the seeded demo booking would leak into real analytics.)
    const tutorialMode = await isTutorialModeActive()

    const rows = await db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.active, true),
        eq(bookings.isDemo, tutorialMode),
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

    // revenue earned = completed only — scheduled/requested are booked, not
    // earned. The inclusive `rows` set feeds ONLY the All Appointments listing
    // (with status badges); every money figure comes from this subset.
    const earnedRows = rows.filter((b) => b.status === 'completed')

    // price_cents only — never add tip_cents (tips go to stylist, not facility revenue)
    const totalRevenueCents = earnedRows.reduce(
      (sum, b) => sum + (b.priceCents ?? b.service?.priceCents ?? 0),
      0
    )
    const totalAppointments = earnedRows.length

    // Revenue by service (earned only)
    const serviceMap = new Map<string, { name: string; count: number; revenueCents: number }>()
    for (const b of earnedRows) {
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

    // Revenue by stylist (earned only — the Commissions block's "Based on
    // completed appointments" label is now actually true)
    const stylistMap = new Map<string, { name: string; count: number; revenueCents: number; commissionPercent: number }>()
    for (const b of earnedRows) {
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

    // Busiest days (top 5, earned only) — bucketed on the FACILITY's calendar
    // day so the chip matches the dates shown in the appointments table.
    const dayMap = new Map<string, number>()
    for (const b of earnedRows) {
      const p = getLocalParts(new Date(b.startTime), facilityTz)
      const dateStr = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
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
