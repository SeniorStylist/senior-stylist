import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, eq, gte, lt, ne } from 'drizzle-orm'

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const now = new Date()

    // Today
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const todayEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))

    // This week (Mon–Sun)
    const dayOfWeek = now.getUTCDay() // 0 = Sun
    const daysFromMon = (dayOfWeek + 6) % 7
    const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMon))
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000)

    // This month
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

    const [todayRows, weekRows, monthRows] = await Promise.all([
      db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facilityId),
          ne(bookings.status, 'cancelled'),
          ne(bookings.status, 'no_show'),
          gte(bookings.startTime, todayStart),
          lt(bookings.startTime, todayEnd)
        ),
        with: { service: true },
      }),
      db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facilityId),
          ne(bookings.status, 'cancelled'),
          ne(bookings.status, 'no_show'),
          gte(bookings.startTime, weekStart),
          lt(bookings.startTime, weekEnd)
        ),
        with: { service: true },
      }),
      db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facilityId),
          ne(bookings.status, 'cancelled'),
          ne(bookings.status, 'no_show'),
          gte(bookings.startTime, monthStart),
          lt(bookings.startTime, monthEnd)
        ),
        with: { service: true },
      }),
    ])

    // price_cents only — never add tip_cents (tips go to stylist, not facility revenue)
    const sum = (rows: typeof todayRows) =>
      rows.reduce((s, b) => s + (b.priceCents ?? b.service?.priceCents ?? 0), 0)

    return Response.json({
      data: {
        today: { count: todayRows.length, revenueCents: sum(todayRows) },
        thisWeek: { count: weekRows.length, revenueCents: sum(weekRows) },
        thisMonth: { count: monthRows.length, revenueCents: sum(monthRows) },
      },
    })
  } catch (err) {
    console.error('GET /api/stats error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
