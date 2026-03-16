import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { residents, bookings } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
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

  const [residentsList, bookingsList] = await Promise.all([
    db.query.residents.findMany({
      where: and(
        eq(residents.facilityId, facilityUser.facilityId),
        eq(residents.active, true)
      ),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityUser.facilityId),
        ne(bookings.status, 'cancelled')
      ),
      orderBy: (t, { desc }) => [desc(t.startTime)],
    }),
  ])

  // Aggregate per-resident stats
  type Stats = { lastVisit: string | null; totalSpent: number; count: number }
  const statsMap = new Map<string, Stats>()

  for (const b of bookingsList) {
    const existing = statsMap.get(b.residentId)
    const visitTime =
      b.startTime instanceof Date
        ? b.startTime.toISOString()
        : String(b.startTime)

    if (!existing) {
      statsMap.set(b.residentId, {
        lastVisit: visitTime,
        totalSpent: b.priceCents ?? 0,
        count: 1,
      })
    } else {
      existing.totalSpent += b.priceCents ?? 0
      existing.count++
      // bookings sorted desc — first entry is already the most recent
    }
  }

  const residentsWithStats = residentsList.map((r) => ({
    ...r,
    lastVisit: statsMap.get(r.id)?.lastVisit ?? null,
    totalSpent: statsMap.get(r.id)?.totalSpent ?? 0,
    appointmentCount: statsMap.get(r.id)?.count ?? 0,
  }))

  return (
    <ResidentsPageClient
      residents={JSON.parse(JSON.stringify(residentsWithStats))}
    />
  )
}
