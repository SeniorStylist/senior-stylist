import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { bookings, logEntries, residents, stylists, services, profiles, facilities, stylistFacilityAssignments } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { getEffectiveStylistId } from '@/lib/effective-stylist'
import { isTutorialModeActive } from '@/lib/help/tutorial-request'
import { toClientJson } from '@/lib/sanitize'
import { getMostUsedServiceIds } from '@/lib/resident-service-usage'
import { eq, and, gte, lt, asc, or, inArray } from 'drizzle-orm'
import { LogClient } from './log-client'

export default async function LogPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  const { facilityId } = facilityUser

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  // P30 full lockdown — a stylist sees ONLY their own section. Identity comes
  // from getEffectiveStylistId (honors the master debug impersonation's picked
  // stylist, so previewing "Stylist" behaves like the real account instead of
  // unlocking the whole roster). Unlinked account → read-only + banner.
  let stylistFilter: string | null = null
  let unlinkedStylist = false
  if (facilityUser.role === 'stylist') {
    stylistFilter = await getEffectiveStylistId(user.id)
    unlinkedStylist = !stylistFilter
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
    mostUsedMap,
  ] = await Promise.all([
    db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.active, true),
        eq(bookings.isDemo, tutorialMode), // is_demo filter — Phase 13 (demo-only during a tour)
        gte(bookings.startTime, dayStart),
        lt(bookings.startTime, dayEnd),
        // P30 — stylists get only their own rows (unlinked → none)
        ...(facilityUser.role === 'stylist'
          ? [eq(bookings.stylistId, stylistFilter ?? '00000000-0000-0000-0000-000000000000')]
          : [])
      ),
      with: { resident: true, stylist: true, service: true, importBatch: { columns: { id: true, fileName: true } } },
      orderBy: (t, { asc }) => [asc(t.startTime)],
    }),
    db.query.logEntries.findMany({
      where: and(
        eq(logEntries.facilityId, facilityId),
        eq(logEntries.isDemo, tutorialMode), // is_demo filter — Phase 13 (demo-only during a tour)
        eq(logEntries.date, today),
        ...(facilityUser.role === 'stylist'
          ? [eq(logEntries.stylistId, stylistFilter ?? '00000000-0000-0000-0000-000000000000')]
          : [])
      ),
    }),
    db.query.residents.findMany({
      where: and(eq(residents.facilityId, facilityId), eq(residents.active, true), eq(residents.isDemo, tutorialMode)), // is_demo filter — Phase 13 (demo-only during a tour)
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    // Stylists working THIS facility = home rows (stylists.facility_id) PLUS
    // assignment-linked rows (stylist_facility_assignments). Facilities served by
    // franchise-pool / cross-facility stylists have ZERO home rows, which left the
    // daily-log stylist dropdowns EMPTY — the "can't edit the Stylist" bookkeeper
    // report (2026-07-13, F228). Never query stylists by facility_id alone on a
    // roster surface.
    (async () => {
      const assigned = await db
        .select({ stylistId: stylistFacilityAssignments.stylistId })
        .from(stylistFacilityAssignments)
        .where(
          and(
            eq(stylistFacilityAssignments.facilityId, facilityId),
            eq(stylistFacilityAssignments.active, true),
          ),
        )
      const assignedIds = assigned.map((a) => a.stylistId)
      return db.query.stylists.findMany({
        where: and(
          eq(stylists.active, true),
          eq(stylists.isDemo, tutorialMode), // is_demo filter — Phase 13 (demo-only during a tour)
          assignedIds.length > 0
            ? or(eq(stylists.facilityId, facilityId), inArray(stylists.id, assignedIds))
            : eq(stylists.facilityId, facilityId),
        ),
        orderBy: (t, { asc }) => [asc(t.name)],
      })
    })(),
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
    // P31 — cached (5 min, 'bookings' tag) and folded into the batch instead
    // of a sequential round-trip after it.
    getMostUsedServiceIds(facilityId),
  ])

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
      unlinkedStylist={unlinkedStylist}
      serviceCategoryOrder={facility?.serviceCategoryOrder ?? null}
      facilityTimezone={facility?.timezone ?? 'America/New_York'}
      facilityId={facilityId}
      facilityName={facility?.name ?? ''}
      role={facilityUser.role}
      exportFacilities={exportFacilities}
      isMaster={isMaster}
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
