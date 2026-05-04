import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { bookings, logEntries, residents, stylists, services, profiles, facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { toClientJson } from '@/lib/sanitize'
import { getMostUsedServiceIds } from '@/lib/resident-service-usage'
import { eq, and, gte, lt } from 'drizzle-orm'
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

  // If user is a stylist, look up their linked stylist profile for filtering
  let stylistFilter: string | null = null
  if (facilityUser.role === 'stylist') {
    const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
    stylistFilter = profile?.stylistId ?? null
  }

  try {
  const today = new Date().toISOString().split('T')[0]
  const dayStart = new Date(today + 'T00:00:00.000Z')
  const dayEnd = new Date(today + 'T23:59:59.999Z')

  const [
    todayBookings,
    todayLogEntries,
    residentsList,
    stylistsList,
    servicesList,
    facility,
  ] = await Promise.all([
    db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.active, true),
        gte(bookings.startTime, dayStart),
        lt(bookings.startTime, dayEnd)
      ),
      with: { resident: true, stylist: true, service: true, importBatch: { columns: { fileName: true } } },
      orderBy: (t, { asc }) => [asc(t.startTime)],
    }),
    db.query.logEntries.findMany({
      where: and(
        eq(logEntries.facilityId, facilityId),
        eq(logEntries.date, today)
      ),
    }),
    db.query.residents.findMany({
      where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.stylists.findMany({
      where: and(eq(stylists.facilityId, facilityId), eq(stylists.active, true)),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.services.findMany({
      where: and(eq(services.facilityId, facilityId), eq(services.active, true)),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { serviceCategoryOrder: true, timezone: true },
    }),
  ])

  const mostUsedMap = await getMostUsedServiceIds(facilityId)
  const residentsWithUsage = residentsList.map((r) => ({
    ...r,
    mostUsedServiceId: mostUsedMap.get(r.id) ?? null,
  }))

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
      role={facilityUser.role}
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
