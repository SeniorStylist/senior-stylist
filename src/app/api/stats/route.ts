import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { getUserFacility } from '@/lib/get-facility-id'
import { isTutorialRequest } from '@/lib/help/tutorial-request'
import { sql } from 'drizzle-orm'

export async function GET(request: Request) {
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

    // The week can straddle the month boundary in both directions — the outer
    // scan covers the union of the two ranges, each bucket filters its own.
    const rangeStart = weekStart < monthStart ? weekStart : monthStart
    const rangeEnd = weekEnd > monthEnd ? weekEnd : monthEnd

    const tutorialMode = isTutorialRequest(request)

    // Phase 25 — one aggregate query (was three unbounded findMany reads with a
    // service join, reduced to two integers each in JS). Also fixes two latent
    // filter gaps: `active = true` (rolled-back imports counted toward revenue)
    // and the is_demo filter — Phase 13 (seeded tutorial bookings counted too).
    // price_cents only — never add tip_cents (tips go to stylist, not facility revenue)
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE b.start_time >= ${todayStart.toISOString()}::timestamptz AND b.start_time < ${todayEnd.toISOString()}::timestamptz) AS today_count,
        COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)) FILTER (WHERE b.start_time >= ${todayStart.toISOString()}::timestamptz AND b.start_time < ${todayEnd.toISOString()}::timestamptz), 0) AS today_cents,
        COUNT(*) FILTER (WHERE b.start_time >= ${weekStart.toISOString()}::timestamptz AND b.start_time < ${weekEnd.toISOString()}::timestamptz) AS week_count,
        COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)) FILTER (WHERE b.start_time >= ${weekStart.toISOString()}::timestamptz AND b.start_time < ${weekEnd.toISOString()}::timestamptz), 0) AS week_cents,
        COUNT(*) FILTER (WHERE b.start_time >= ${monthStart.toISOString()}::timestamptz AND b.start_time < ${monthEnd.toISOString()}::timestamptz) AS month_count,
        COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)) FILTER (WHERE b.start_time >= ${monthStart.toISOString()}::timestamptz AND b.start_time < ${monthEnd.toISOString()}::timestamptz), 0) AS month_cents
      FROM bookings b
      LEFT JOIN services s ON s.id = b.service_id
      WHERE b.facility_id = ${facilityId}
        AND b.status NOT IN ('cancelled', 'no_show')
        AND b.active = true
        AND b.is_demo = ${tutorialMode}
        AND b.start_time >= ${rangeStart.toISOString()}::timestamptz
        AND b.start_time < ${rangeEnd.toISOString()}::timestamptz
    `)

    // postgres driver returns iterable rows directly (no .rows wrapper);
    // aggregates come back as strings — normalize with Number().
    const row = (rows as unknown as Array<Record<string, number | string>>)[0] ?? {}
    const n = (v: number | string | undefined) => Number(v ?? 0)

    return Response.json({
      data: {
        today: { count: n(row.today_count), revenueCents: n(row.today_cents) },
        thisWeek: { count: n(row.week_count), revenueCents: n(row.week_cents) },
        thisMonth: { count: n(row.month_count), revenueCents: n(row.month_cents) },
      },
    })
  } catch (err) {
    console.error('GET /api/stats error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
