import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities, residents, stylists, services } from '@/db/schema'
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

    return (
      <DashboardClient
        facilityId={facilityUser.facilityId}
        facility={JSON.parse(JSON.stringify(facility))}
        initialResidents={JSON.parse(JSON.stringify(residentsList))}
        initialStylists={JSON.parse(JSON.stringify(stylistsList))}
        initialServices={JSON.parse(JSON.stringify(servicesList))}
      />
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
