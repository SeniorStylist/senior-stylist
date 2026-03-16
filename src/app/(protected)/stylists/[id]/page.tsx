import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/db'
import { bookings, stylists, facilityUsers } from '@/db/schema'
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

  const facilityUser = await db.query.facilityUsers.findFirst({
    where: (t, { eq }) => eq(t.userId, user.id),
  })
  if (!facilityUser) redirect('/dashboard')

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

  const stats = {
    thisWeek: weekBookings.length,
    thisMonth: monthBookings.length,
    totalRevenue: allTimeBookings.reduce((sum, b) => sum + (b.priceCents ?? 0), 0),
    totalBookings: allTimeBookings.length,
  }

  return (
    <StylistDetailClient
      stylist={JSON.parse(JSON.stringify(stylist))}
      upcomingBookings={JSON.parse(JSON.stringify(upcomingBookings))}
      stats={stats}
    />
  )
}
