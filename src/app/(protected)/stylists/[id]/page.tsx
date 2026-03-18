import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db'
import { bookings, stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and, gte, lte, ne } from 'drizzle-orm'
import { StylistDetailClient } from './stylist-detail-client'

export default async function StylistDetailPage({
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

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')

  try {
  const stylist = await db.query.stylists.findFirst({
    where: and(
      eq(stylists.id, id),
      eq(stylists.facilityId, facilityUser.facilityId)
    ),
  })
  if (!stylist) notFound()

  const now = new Date()
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  // Start of current week (Sunday)
  const startOfWeek = new Date(now)
  startOfWeek.setHours(0, 0, 0, 0)
  startOfWeek.setDate(now.getDate() - now.getDay())

  // Start of current month
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [upcomingBookings, allTimeBookings] = await Promise.all([
    db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityUser.facilityId),
        eq(bookings.stylistId, id),
        gte(bookings.startTime, now),
        lte(bookings.startTime, in14Days),
        ne(bookings.status, 'cancelled')
      ),
      with: { resident: true, service: true },
      orderBy: (t, { asc }) => [asc(t.startTime)],
    }),
    db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityUser.facilityId),
        eq(bookings.stylistId, id),
        ne(bookings.status, 'cancelled')
      ),
    }),
  ])

  const weekBookings = allTimeBookings.filter(
    (b) => new Date(b.startTime) >= startOfWeek
  )
  const monthBookings = allTimeBookings.filter(
    (b) => new Date(b.startTime) >= startOfMonth
  )
  // Get this month's bookings with service names for commission breakdown
  const allBookingsWithService = await db.query.bookings.findMany({
    where: and(
      eq(bookings.facilityId, facilityUser.facilityId),
      eq(bookings.stylistId, id),
      ne(bookings.status, 'cancelled'),
      gte(bookings.startTime, startOfMonth)
    ),
    with: { service: true },
  })

  const completedMonthBookings = allBookingsWithService.filter((b) => b.status === 'completed')
  const monthRevenue = completedMonthBookings.reduce((sum, b) => sum + (b.priceCents ?? 0), 0)

  const serviceBreakdownMap = new Map<string, { serviceName: string; count: number; revenueCents: number }>()
  for (const b of completedMonthBookings) {
    const existing = serviceBreakdownMap.get(b.serviceId)
    const price = b.priceCents ?? 0
    if (existing) {
      existing.count++
      existing.revenueCents += price
    } else {
      serviceBreakdownMap.set(b.serviceId, { serviceName: b.service.name, count: 1, revenueCents: price })
    }
  }

  const serviceBreakdown = Array.from(serviceBreakdownMap.values())
    .map((row) => ({
      ...row,
      commissionCents: Math.round(row.revenueCents * stylist.commissionPercent / 100),
    }))
    .sort((a, b) => b.revenueCents - a.revenueCents)

  const stats = {
    thisWeek: weekBookings.length,
    thisMonth: monthBookings.length,
    totalRevenue: allTimeBookings.reduce((sum, b) => sum + (b.priceCents ?? 0), 0),
    totalBookings: allTimeBookings.length,
    monthRevenue,
    serviceBreakdown,
  }

  return (
    <StylistDetailClient
      stylist={JSON.parse(JSON.stringify(stylist))}
      upcomingBookings={JSON.parse(JSON.stringify(upcomingBookings))}
      stats={stats}
    />
  )
  } catch (err) {
    console.error('[StylistDetailPage] DB error:', err)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg mt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">Failed to load stylist details. Please refresh to try again.</p>
        </div>
      </div>
    )
  }
}
