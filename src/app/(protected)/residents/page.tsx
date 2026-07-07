import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { residents, bookings } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { isTutorialModeActive } from '@/lib/help/tutorial-request'
import { eq, and, ne } from 'drizzle-orm'
import { ResidentsPageClient } from './residents-page-client'

export default async function ResidentsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (facilityUser.role === 'stylist') redirect('/dashboard')

  const tutorialMode = await isTutorialModeActive()

  try {
  const [residentsList, bookingsList] = await Promise.all([
    db.query.residents.findMany({
      where: and(
        eq(residents.facilityId, facilityUser.facilityId),
        eq(residents.active, true),
        eq(residents.isDemo, tutorialMode) // is_demo filter — Phase 13
      ),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityUser.facilityId),
        ne(bookings.status, 'cancelled'),
        eq(bookings.active, true) // rolled-back imports must not count in stats
      ),
      orderBy: (t, { desc }) => [desc(t.startTime)],
    }),
  ])

  // Aggregate per-resident stats
  type Stats = { lastVisit: string | null; totalSpent: number; count: number; noShowCount: number }
  const statsMap = new Map<string, Stats>()
  // Phase 16 G7 — no-shows in the last 90 days drive the reliability chip
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000

  for (const b of bookingsList) {
    const existing = statsMap.get(b.residentId)
    const visitTime =
      b.startTime instanceof Date
        ? b.startTime.toISOString()
        : String(b.startTime)
    const isRecentNoShow = b.status === 'no_show' && new Date(b.startTime).getTime() > ninetyDaysAgo

    if (!existing) {
      statsMap.set(b.residentId, {
        lastVisit: visitTime,
        totalSpent: b.priceCents ?? 0,
        count: 1,
        noShowCount: isRecentNoShow ? 1 : 0,
      })
    } else {
      existing.totalSpent += b.priceCents ?? 0
      existing.count++
      if (isRecentNoShow) existing.noShowCount++
      // bookings sorted desc — first entry is already the most recent
    }
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
