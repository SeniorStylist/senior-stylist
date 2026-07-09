import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { isTutorialModeActive } from '@/lib/help/tutorial-request'
import { eq, and, sql } from 'drizzle-orm'
import { ResidentsPageClient } from './residents-page-client'

export default async function ResidentsPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (facilityUser.role === 'stylist') redirect('/dashboard')

  const tutorialMode = await isTutorialModeActive()

  try {
  // Phase 25 — per-resident stats are aggregated in Postgres. The old version
  // streamed EVERY non-cancelled booking in the facility (unbounded — years of
  // history) over the max:1 pooled connection just to reduce it in JS.
  // price_cents only — never add tip_cents (tips go to stylist, not facility revenue)
  const ninetyDaysAgoIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const [residentsList, statsRows] = await Promise.all([
    db.query.residents.findMany({
      where: and(
        eq(residents.facilityId, facilityUser.facilityId),
        eq(residents.active, true),
        eq(residents.isDemo, tutorialMode) // is_demo filter — Phase 13
      ),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.execute(sql`
      SELECT
        resident_id,
        MAX(start_time) AS last_visit,
        COALESCE(SUM(COALESCE(price_cents, 0)), 0) AS total_spent,
        COUNT(*) AS booking_count,
        COUNT(*) FILTER (
          WHERE status = 'no_show' AND start_time > ${ninetyDaysAgoIso}::timestamptz
        ) AS no_show_count
      FROM bookings
      WHERE facility_id = ${facilityUser.facilityId}
        AND status != 'cancelled'
        AND active = true
      GROUP BY resident_id
    `),
  ])

  // Aggregate per-resident stats (postgres driver: iterable rows, bigints as strings)
  type Stats = { lastVisit: string | null; totalSpent: number; count: number; noShowCount: number }
  const statsMap = new Map<string, Stats>()
  for (const row of statsRows as unknown as Array<{
    resident_id: string
    last_visit: Date | string | null
    total_spent: number | string
    booking_count: number | string
    no_show_count: number | string
  }>) {
    if (!row.resident_id) continue
    statsMap.set(row.resident_id, {
      lastVisit: row.last_visit
        ? row.last_visit instanceof Date
          ? row.last_visit.toISOString()
          : new Date(row.last_visit).toISOString()
        : null,
      totalSpent: Number(row.total_spent),
      count: Number(row.booking_count),
      noShowCount: Number(row.no_show_count),
    })
  }

  const residentsWithStats = residentsList.map((r) => ({
    ...r,
    lastVisit: statsMap.get(r.id)?.lastVisit ?? null,
    totalSpent: statsMap.get(r.id)?.totalSpent ?? 0,
    appointmentCount: statsMap.get(r.id)?.count ?? 0,
    noShowCount: statsMap.get(r.id)?.noShowCount ?? 0,
  }))

  return (
    <ResidentsPageClient
      residents={JSON.parse(JSON.stringify(residentsWithStats))}
      facilityId={facilityUser.facilityId}
      role={facilityUser.role}
    />
  )
  } catch (err) {
    console.error('[ResidentsPage] DB error:', err)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg mt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">Failed to load residents. Please refresh to try again.</p>
        </div>
      </div>
    )
  }
}
