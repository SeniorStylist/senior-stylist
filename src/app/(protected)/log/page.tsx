import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { bookings, logEntries, residents, stylists, services, facilityUsers } from '@/db/schema'
import { eq, and, gte, lt } from 'drizzle-orm'
import { LogClient } from './log-client'

export default async function LogPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await db.query.facilityUsers.findFirst({
    where: (t, { eq }) => eq(t.userId, user.id),
  })
  if (!facilityUser) redirect('/dashboard')
  const { facilityId } = facilityUser

  const today = new Date().toISOString().split('T')[0]
  const dayStart = new Date(today + 'T00:00:00.000Z')
  const dayEnd = new Date(today + 'T23:59:59.999Z')

  const [
    todayBookings,
    todayLogEntries,
    residentsList,
    stylistsList,
    servicesList,
  ] = await Promise.all([
    db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityId),
        gte(bookings.startTime, dayStart),
        lt(bookings.startTime, dayEnd)
      ),
      with: { resident: true, stylist: true, service: true },
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
  ])

  return (
    <LogClient
      initialDate={today}
      initialBookings={JSON.parse(JSON.stringify(todayBookings))}
      initialLogEntries={JSON.parse(JSON.stringify(todayLogEntries))}
      residents={JSON.parse(JSON.stringify(residentsList))}
      stylists={JSON.parse(JSON.stringify(stylistsList))}
      services={JSON.parse(JSON.stringify(servicesList))}
    />
  )
}
