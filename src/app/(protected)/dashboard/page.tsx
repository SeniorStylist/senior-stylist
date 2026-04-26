import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities, residents, stylists, services, invites, accessRequests, profiles, coverageRequests, stylistFacilityAssignments, stylistAvailability } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { sanitizeStylists, sanitizeFacility, toClientJson } from '@/lib/sanitize'
import { getMostUsedServiceIds } from '@/lib/resident-service-usage'
import { DashboardClient } from './dashboard-client'
import { DashboardSetup } from './dashboard-setup'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // These checks must be OUTSIDE try/catch — Next.js redirect() throws internally
  // and a surrounding catch block swallows it, showing the error UI instead.
  const facilityUser = await getUserFacility(user.id)

  if (!facilityUser) {
    const isSuperAdmin =
      process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    if (isSuperAdmin) {
      // Super admin with no active facility → show setup UI
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

    // Check for valid invite
    const invite = await db.query.invites.findFirst({
      where: and(
        eq(invites.email, user.email ?? ''),
        eq(invites.used, false),
      ),
    })

    if (!invite) {
      redirect('/unauthorized')
    }

    // Invited user with no facility → onboarding wizard
    redirect('/onboarding')
  }

  if (facilityUser.role === 'bookkeeper') redirect('/billing')

  // If stylist, look up linked stylist record for filtering
  let profileStylistId: string | null = null
  if (facilityUser.role === 'stylist') {
    const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
    profileStylistId = profile?.stylistId ?? null
  }

  // Has a facility — load dashboard data (try/catch only wraps DB queries)
  try {
    const [facility, residentsList, stylistsList, servicesList, pendingRequests, openCoverageRequests, working] = await Promise.all([
      db.query.facilities.findFirst({
        where: eq(facilities.id, facilityUser.facilityId),
      }),
      db.query.residents.findMany({
        where: and(
          eq(residents.facilityId, facilityUser.facilityId),
          eq(residents.active, true)
        ),
        orderBy: (t, { asc }) => [asc(t.name)],
      }),
      db.query.stylists.findMany({
        where: and(
          eq(stylists.facilityId, facilityUser.facilityId),
          eq(stylists.active, true)
        ),
        orderBy: (t, { asc }) => [asc(t.name)],
      }),
      db.query.services.findMany({
        where: and(
          eq(services.facilityId, facilityUser.facilityId),
          eq(services.active, true)
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
              eq(coverageRequests.status, 'open')
            ),
            with: { stylist: { columns: { id: true, name: true } } },
            orderBy: (t, { asc }) => [asc(t.startDate), asc(t.createdAt)],
          })
        : Promise.resolve([]),
      facilityUser.role === 'admin'
        ? (async () => {
            const today = new Date()
            const dow = today.getDay()
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
    ])

    if (!facility) redirect('/login')

    const mostUsedMap = await getMostUsedServiceIds(facilityUser.facilityId)
    const residentsWithUsage = residentsList.map((r) => ({
      ...r,
      mostUsedServiceId: mostUsedMap.get(r.id) ?? null,
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
        />
      </>
    )
  } catch (err) {
    console.error('Dashboard error:', err)
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-stone-900 mb-2">Dashboard</h1>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg">
          <p className="text-sm text-red-700">
            Failed to load dashboard. Check your database connection.
          </p>
        </div>
      </div>
    )
  }
}
