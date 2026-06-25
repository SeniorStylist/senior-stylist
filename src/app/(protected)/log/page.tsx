import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { db } from '@/db'
import { bookings, logEntries, residents, stylists, services, profiles, facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { isTutorialModeActive } from '@/lib/help/tutorial-request'
import { toClientJson } from '@/lib/sanitize'
import { getMostUsedServiceIds } from '@/lib/resident-service-usage'
import { eq, and, gte, lt, asc } from 'drizzle-orm'
import { LogClient } from './log-client'

export default async function LogPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  const { facilityId } = facilityUser

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  // If user is a stylist, look up their linked stylist profile for filtering.
  // Skip in debug impersonation: a master admin previewing "Stylist" has no
  // specific stylist identity, so filtering by their OWN profile.stylistId
  // would wrongly empty the list. Show all facility bookings instead.
  const isDebugImpersonation = !!(await cookies()).get('__debug_role')?.value
  let stylistFilter: string | null = null
  if (facilityUser.role === 'stylist' && !isDebugImpersonation) {
    const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
    stylistFilter = profile?.stylistId ?? null
  }

  try {
  const today = new Date().toISOString().split('T')[0]
  const dayStart = new Date(today + 'T00:00:00.000Z')
  const dayEnd = new Date(today + 'T23:59:59.999Z')

  // Phase 13 — surface demo records during an active scripted tour.
  const tutorialMode = await isTutorialModeActive()

  const [
    todayBookings,
    todayLogEntries,
    residentsList,
    stylistsList,
    servicesList,
    facility,
    exportFacilitiesRaw,
  ] = await Promise.all([
    db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.active, true),
        eq(bookings.isDemo, tutorialMode), // is_demo filter — Phase 13 (demo-only during a tour)
        gte(bookings.startTime, dayStart),
        lt(bookings.startTime, dayEnd)
      ),
      with: { resident: true, stylist: true, service: true, importBatch: { columns: { fileName: true } } },
      orderBy: (t, { asc }) => [asc(t.startTime)],
    }),
    db.query.logEntries.findMany({
      where: and(
        eq(logEntries.facilityId, facilityId),
        eq(logEntries.isDemo, tutorialMode), // is_demo filter — Phase 13 (demo-only during a tour)
        eq(logEntries.date, today)
      ),
    }),
    db.query.residents.findMany({
      where: and(eq(residents.facilityId, facilityId), eq(residents.active, true), eq(residents.isDemo, tutorialMode)), // is_demo filter — Phase 13 (demo-only during a tour)
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.stylists.findMany({
      where: and(eq(stylists.facilityId, facilityId), eq(stylists.active, true), eq(stylists.isDemo, tutorialMode)), // is_demo filter — Phase 13 (demo-only during a tour)
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.services.findMany({
      where: and(eq(services.facilityId, facilityId), eq(services.active, true), eq(services.isDemo, tutorialMode)), // is_demo filter — Phase 13 (demo-only during a tour)
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { serviceCategoryOrder: true, timezone: true, name: true },
    }),
    // Bookkeepers and master admin have cross-facility export access; fetch all
    // active facilities so the Export modal can offer multi-facility selection.
    (facilityUser.role === 'bookkeeper' || isMaster)
      ? db.query.facilities.findMany({
          where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
          columns: { id: true, name: true, facilityCode: true },
          orderBy: [asc(facilities.name)],
        })
      : Promise.resolve(null),
  ])

  const mostUsedMap = await getMostUsedServiceIds(facilityId)
  const residentsWithUsage = residentsList.map((r) => ({
    ...r,
    mostUsedServiceId: mostUsedMap.get(r.id) ?? null,
  }))

  // Shape export facilities: bookkeeper/master get the full list; everyone else
  // gets a single-item list (their current facility) so LogClient can use a
  // unified prop regardless of role.
  const exportFacilities = exportFacilitiesRaw ?? [
    { id: facilityId, name: facility?.name ?? '', facilityCode: null },
  ]

  return (
    <LogClient
      initialDate={today}
      initialBookings={toClientJson(todayBookings)}
      initialLogEntries={toClientJson(todayLogEntries)}
      residents={toClientJson(residentsWithUsage)}
      stylists={toClientJson(stylistsList)}
      services={toClientJson(servicesList)}
      stylistFilter={stylistFilter}
      serviceCategoryOrder={facility?.serviceCategoryOrder ?? null}
      facilityTimezone={facility?.timezone ?? 'America/New_York'}
      facilityId={facilityId}
      facilityName={facility?.name ?? ''}
      role={facilityUser.role}
      exportFacilities={exportFacilities}
    />
  )
  } catch (err) {
    console.error('[LogPage] DB error:', err)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg mt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">Failed to load the log. Please refresh to try again.</p>
        </div>
      </div>
    )
  }
}
