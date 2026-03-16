import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db'
import { residents, bookings, facilityUsers } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { ResidentDetailClient } from './resident-detail-client'

export default async function ResidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await db.query.facilityUsers.findFirst({
    where: (t, { eq }) => eq(t.userId, user.id),
  })
  if (!facilityUser) redirect('/dashboard')

  const resident = await db.query.residents.findFirst({
    where: and(
      eq(residents.id, id),
      eq(residents.facilityId, facilityUser.facilityId)
    ),
  })
  if (!resident) notFound()

  const residentBookings = await db.query.bookings.findMany({
    where: and(
      eq(bookings.residentId, id),
      eq(bookings.facilityId, facilityUser.facilityId)
    ),
    with: {
      stylist: true,
      service: true,
    },
    orderBy: (t, { desc }) => [desc(t.startTime)],
  })

  // Compute stats
  const activeBookings = residentBookings.filter((b) => b.status !== 'cancelled')
  const totalSpent = activeBookings.reduce((sum, b) => sum + (b.priceCents ?? 0), 0)
  const firstVisitEntry = activeBookings.length > 0
    ? activeBookings[activeBookings.length - 1]
    : null
  const firstVisit = firstVisitEntry
    ? (firstVisitEntry.startTime instanceof Date
        ? firstVisitEntry.startTime.toISOString()
        : String(firstVisitEntry.startTime))
    : null

  // Most common service
  const serviceCounts = new Map<string, { name: string; count: number }>()
  for (const b of activeBookings) {
    const existing = serviceCounts.get(b.serviceId)
    if (!existing) {
      serviceCounts.set(b.serviceId, { name: b.service.name, count: 1 })
    } else {
      existing.count++
    }
  }
  let mostCommonService: string | null = null
  let maxCount = 0
  for (const { name, count } of serviceCounts.values()) {
    if (count > maxCount) { mostCommonService = name; maxCount = count }
  }

  const stats = {
    total: activeBookings.length,
    totalSpent,
    mostCommonService,
    firstVisit,
  }

  return (
    <ResidentDetailClient
      resident={JSON.parse(JSON.stringify(resident))}
      bookings={JSON.parse(JSON.stringify(residentBookings))}
      stats={stats}
    />
  )
}
