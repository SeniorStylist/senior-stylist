import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities, residents, stylists, services, invites } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { DashboardClient } from './dashboard-client'
import { DashboardSetup } from './dashboard-setup'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  try {
    const facilityUser = await getUserFacility(user.id)

    if (!facilityUser) {
      // Check for valid invite
      const invite = await db.query.invites.findFirst({
        where: and(
          eq(invites.email, user.email ?? ''),
          eq(invites.used, false),
        ),
      })

      // Super admin bypass
      const isSuperAdmin = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
        user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

      if (!invite && !isSuperAdmin) {
        redirect('/unauthorized')
      }

      // New users without a facility go to onboarding wizard
      if (!isSuperAdmin) {
        redirect('/onboarding')
      }

      return (
        <div className="p-8">
          <h1
            className="text-2xl font-bold text-stone-900 mb-2"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Dashboard
          </h1>
          <DashboardSetup />
        </div>
      )
    }

    const [facility, residentsList, stylistsList, servicesList] = await Promise.all([
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
    ])

    if (!facility) redirect('/login')

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isSuperAdminActingAsFacility =
      superAdminEmail &&
      user.email === superAdminEmail &&
      facilityUser.role === 'admin'

    return (
      <>
        {isSuperAdminActingAsFacility && (
          <div className="shrink-0 bg-[#0D7377] text-white text-sm px-4 py-2 text-center">
            Viewing as: <strong>{facility.name}</strong> —{' '}
            <a href="/super-admin" className="underline">Back to Super Admin</a>
          </div>
        )}
        <DashboardClient
          facilityId={facilityUser.facilityId}
          facility={JSON.parse(JSON.stringify(facility))}
          initialResidents={JSON.parse(JSON.stringify(residentsList))}
          initialStylists={JSON.parse(JSON.stringify(stylistsList))}
          initialServices={JSON.parse(JSON.stringify(servicesList))}
          isAdmin={facilityUser.role === 'admin'}
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
