import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities, residents, stylists, services, invites, accessRequests, profiles, coverageRequests, stylistFacilityAssignments, stylistAvailability, stylistCheckins, bookings } from '@/db/schema'
import { eq, and, gte, lt, notInArray, inArray, asc } from 'drizzle-orm'
import { dayRangeInTimezone, getLocalParts } from '@/lib/time'
import { getUserFacility } from '@/lib/get-facility-id'
import { getEffectiveStylistId } from '@/lib/effective-stylist'
import { isTutorialModeActive } from '@/lib/help/tutorial-request'
import { sanitizeStylists, sanitizeFacility, toClientJson } from '@/lib/sanitize'
import { getMostUsedServiceIds } from '@/lib/resident-service-usage'
import { DashboardClient } from './dashboard-client'
import { DashboardSetup } from './dashboard-setup'

export default async function DashboardPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  // These checks must be OUTSIDE try/catch — Next.js redirect() throws internally
  // and a surrounding catch block swallows it, showing the error UI instead.
  const facilityUser = await getUserFacility(user.id)

  if (!facilityUser) {
    const isSuperAdmin =
      process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    if (isSuperAdmin) {
      // Master admin with no selected facility: when the org already has
      // facilities, this is just a missing selected_facility_id cookie (e.g.
      // after sign-out) — send them to Master Admin to pick one. The
      // first-time setup screen (whose button CREATES a facility + demo data)
      // is only correct on a genuinely empty database.
      const anyFacility = await db.query.facilities.findFirst({
        where: eq(facilities.active, true),
        columns: { id: true },
      })
      if (anyFacility) redirect('/master-admin')

      // Genuinely empty database → first-run setup UI
      return (
        <div className="p-8">
          <h1
            className="text-2xl font-normal text-stone-900 mb-2"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Dashboard
          </h1>
          <DashboardSetup />
        </div>
      )
    }

    // Check for valid invite (explicit columns — avoids selecting the invite
    // tracking columns so this never breaks if that migration is mid-rollout)
    const invite = await db.query.invites.findFirst({
      where: and(
        eq(invites.email, user.email ?? ''),
        eq(invites.used, false),
      ),
      columns: { id: true },
    })

    if (!invite) {
      redirect('/unauthorized')
    }

    // Invited user with no facility → onboarding wizard
    redirect('/onboarding')
  }

  if (facilityUser.role === 'bookkeeper') redirect('/log')

  // Fetch profile once: hasSeenOnboardingTour (welcome modal flag) + tour progress.
  // P30 — the stylist identity comes from getEffectiveStylistId (honors the
  // master-gated debug cookie's stylistId, else profiles.stylistId) so debug
  // impersonation behaves exactly like the real stylist.
  const [profile, effectiveStylistId] = await Promise.all([
    db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { hasSeenOnboardingTour: true, completedTours: true, hasSeenFirstTour: true },
    }),
    facilityUser.role === 'stylist' ? getEffectiveStylistId(user.id) : Promise.resolve(null),
  ])
  const profileStylistId = facilityUser.role === 'stylist' ? effectiveStylistId : null
  const showOnboardingModal = !profile?.hasSeenOnboardingTour
  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  // Has a facility — load dashboard data (try/catch only wraps DB queries)
  try {
    // Phase 12T — pre-compute facility timezone + today's date range so the
    // stylist check-in + today's bookings queries below can use them.
    // ONE facility fetch serves the tz pre-compute AND the client prop (audit
    // 2026-07: this row was fetched 3× on every dashboard render).
    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityUser.facilityId),
    })
    const facilityTz = facility?.timezone ?? 'America/New_York'
    const todayParts = getLocalParts(new Date(), facilityTz)
    const todayDateStr = `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`
    const todayRange = dayRangeInTimezone(todayDateStr, facilityTz)

    // Phase 13 — when a scripted tour is active, surface demo records so the
    // tutorial's seeded resident/service/booking appear in the booking modal etc.
    const tutorialMode = await isTutorialModeActive()

    const [residentsList, stylistsList, servicesList, pendingRequests, openCoverageRequests, working, todayCheckin, todayStylistBookings] = await Promise.all([
      db.query.residents.findMany({
        where: and(
          eq(residents.facilityId, facilityUser.facilityId),
          eq(residents.active, true),
          eq(residents.isDemo, tutorialMode) // is_demo filter — Phase 13 (demo-only during a tour)
        ),
        orderBy: (t, { asc }) => [asc(t.name)],
      }),
      db.query.stylists.findMany({
        where: and(
          eq(stylists.facilityId, facilityUser.facilityId),
          eq(stylists.active, true),
          eq(stylists.isDemo, tutorialMode) // is_demo filter — Phase 13 (demo-only during a tour)
        ),
        orderBy: (t, { asc }) => [asc(t.name)],
      }),
      db.query.services.findMany({
        where: and(
          eq(services.facilityId, facilityUser.facilityId),
          eq(services.active, true),
          eq(services.isDemo, tutorialMode), // is_demo filter — Phase 13 (demo-only during a tour)
          eq(services.source, 'price_list') // price-list catalog only (hide bookkeeper ad-hoc)
        ),
        orderBy: (t, { asc }) => [asc(t.name)],
      }),
      facilityUser.role === 'admin'
        ? db.query.accessRequests.findMany({
            where: (t) => and(
              eq(t.facilityId, facilityUser.facilityId),
              eq(accessRequests.status, 'pending')
            ),
          })
        : Promise.resolve([]),
      facilityUser.role === 'admin'
        ? db.query.coverageRequests.findMany({
            where: and(
              eq(coverageRequests.facilityId, facilityUser.facilityId),
              // 13F: pending (needs approve/deny) + open (approved, needs substitute)
              inArray(coverageRequests.status, ['pending', 'open'])
            ),
            with: { stylist: { columns: { id: true, name: true } } },
            orderBy: (t, { asc }) => [asc(t.startDate), asc(t.createdAt)],
          })
        : Promise.resolve([]),
      facilityUser.role === 'admin'
        ? (async () => {
            // Phase 12F — "today" / "tomorrow" anchored to facility tz so
            // a midnight boundary in the viewer's tz can't shift the queried day.
            const today = new Date()
            const tz = facilityTz
            const localWeekday = new Intl.DateTimeFormat('en-US', {
              timeZone: tz, weekday: 'short',
            }).format(today)
            const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
            const dow = dowMap[localWeekday] ?? today.getDay()
            const tomorrow = (dow + 1) % 7
            const [todayRows, tomorrowRows] = await Promise.all([
              db
                .select({
                  id: stylists.id,
                  name: stylists.name,
                  color: stylists.color,
                  startTime: stylistAvailability.startTime,
                  endTime: stylistAvailability.endTime,
                })
                .from(stylists)
                .innerJoin(
                  stylistFacilityAssignments,
                  and(
                    eq(stylistFacilityAssignments.stylistId, stylists.id),
                    eq(stylistFacilityAssignments.facilityId, facilityUser.facilityId),
                    eq(stylistFacilityAssignments.active, true),
                  ),
                )
                .innerJoin(
                  stylistAvailability,
                  and(
                    eq(stylistAvailability.stylistId, stylists.id),
                    eq(stylistAvailability.facilityId, facilityUser.facilityId),
                    eq(stylistAvailability.dayOfWeek, dow),
                    eq(stylistAvailability.active, true),
                  ),
                )
                .where(and(eq(stylists.active, true), eq(stylists.status, 'active')))
                .orderBy(stylistAvailability.startTime),
              db
                .select({ name: stylists.name })
                .from(stylists)
                .innerJoin(
                  stylistFacilityAssignments,
                  and(
                    eq(stylistFacilityAssignments.stylistId, stylists.id),
                    eq(stylistFacilityAssignments.facilityId, facilityUser.facilityId),
                    eq(stylistFacilityAssignments.active, true),
                  ),
                )
                .innerJoin(
                  stylistAvailability,
                  and(
                    eq(stylistAvailability.stylistId, stylists.id),
                    eq(stylistAvailability.facilityId, facilityUser.facilityId),
                    eq(stylistAvailability.dayOfWeek, tomorrow),
                    eq(stylistAvailability.active, true),
                  ),
                )
                .where(and(eq(stylists.active, true), eq(stylists.status, 'active')))
                .orderBy(stylists.name),
            ])
            return { today: todayRows, tomorrow: tomorrowRows }
          })()
        : Promise.resolve({ today: [] as Array<{ id: string; name: string; color: string; startTime: string; endTime: string }>, tomorrow: [] as Array<{ name: string }> }),
      // Phase 12T — stylist-only: today's check-in row (null if not yet checked in)
      profileStylistId
        ? db.query.stylistCheckins.findFirst({
            where: and(
              eq(stylistCheckins.stylistId, profileStylistId),
              eq(stylistCheckins.facilityId, facilityUser.facilityId),
              eq(stylistCheckins.date, todayDateStr),
            ),
          })
        : Promise.resolve(null),
      // Phase 12T — stylist-only: today's bookings (for banner + reschedule sheet)
      profileStylistId && todayRange
        ? db.query.bookings.findMany({
            where: and(
              eq(bookings.stylistId, profileStylistId),
              eq(bookings.facilityId, facilityUser.facilityId),
              eq(bookings.active, true),
              eq(bookings.isDemo, tutorialMode), // is_demo filter — Phase 13 (demo-only during a tour)
              gte(bookings.startTime, todayRange.start),
              lt(bookings.startTime, todayRange.end),
              notInArray(bookings.status, ['cancelled']),
            ),
            columns: { id: true, startTime: true, endTime: true, status: true },
            with: {
              resident: { columns: { id: true, name: true } },
              service: { columns: { id: true, name: true } },
            },
            orderBy: [asc(bookings.startTime)],
          })
        : Promise.resolve([]),
    ])

    if (!facility) redirect('/login')

    const mostUsedMap = await getMostUsedServiceIds(facilityUser.facilityId)
    const residentsWithUsage = residentsList.map((r) => ({
      ...r,
      mostUsedServiceId: mostUsedMap.get(r.id) ?? null,
    }))

    // Phase 12T — shape today's bookings for the check-in banner / reschedule sheet
    const todayBookingsForClient = (todayStylistBookings ?? []).map((b) => ({
      id: b.id,
      startTime: new Date(b.startTime).toISOString(),
      endTime: new Date(b.endTime).toISOString(),
      status: b.status,
      residentName: b.resident?.name ?? 'Resident',
      serviceName: b.service?.name ?? 'Service',
    }))

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isSuperAdminActingAsFacility =
      superAdminEmail &&
      user.email === superAdminEmail &&
      facilityUser.role === 'admin'

    return (
      <>
        {isSuperAdminActingAsFacility && (
          <div className="shrink-0 bg-[#8B2E4A] text-white text-sm px-4 py-2 text-center">
            Viewing as: <strong>{facility.name}</strong> —{' '}
            <a href="/master-admin" className="underline">Back to Master Admin</a>
          </div>
        )}
        <DashboardClient
          facilityId={facilityUser.facilityId}
          facility={toClientJson(sanitizeFacility(facility))}
          initialResidents={JSON.parse(JSON.stringify(residentsWithUsage))}
          initialStylists={JSON.parse(JSON.stringify(sanitizeStylists(stylistsList)))}
          initialServices={JSON.parse(JSON.stringify(servicesList))}
          isAdmin={facilityUser.role === 'admin'}
          userRole={facilityUser.role}
          userName={user.user_metadata?.full_name ?? ''}
          pendingRequestsCount={pendingRequests.length}
          profileStylistId={profileStylistId}
          openCoverageRequests={JSON.parse(JSON.stringify(openCoverageRequests))}
          workingToday={JSON.parse(JSON.stringify(working.today))}
          workingTomorrow={JSON.parse(JSON.stringify(working.tomorrow))}
          showOnboardingModal={showOnboardingModal}
          completedTours={profile?.completedTours ?? []}
          isMaster={isMaster}
          userId={user.id}
          hasSeenFirstTour={profile?.hasSeenFirstTour ?? true}
          alreadyCheckedIn={!!todayCheckin}
          checkinTodayBookings={todayBookingsForClient}
        />
      </>
    )
  } catch (err) {
    console.error('Dashboard error:', err)
    return (
      <div className="p-8">
        <h1 className="text-2xl font-normal text-stone-900 mb-2" style={{ fontFamily: "'DM Serif Display', serif" }}>Dashboard</h1>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg">
          <p className="text-sm text-red-700">
            Failed to load dashboard. Check your database connection.
          </p>
        </div>
      </div>
    )
  }
}
