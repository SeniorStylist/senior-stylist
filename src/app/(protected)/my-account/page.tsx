import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { profiles, stylists, bookings } from '@/db/schema'
import { eq, and, gte, lte } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { MyAccountClient } from './my-account-client'

export default async function MyAccountPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
  })

  let stylist = null
  let weekBookings: any[] = []
  let monthEarningsCents = 0

  if (profile?.stylistId) {
    stylist = await db.query.stylists.findFirst({
      where: eq(stylists.id, profile.stylistId),
    })

    if (stylist) {
      // This week's bookings
      const now = new Date()
      const dayOfWeek = now.getDay()
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - dayOfWeek)
      weekStart.setHours(0, 0, 0, 0)
      const weekEnd = new Date(weekStart)
      weekEnd.setDate(weekStart.getDate() + 7)

      weekBookings = await db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facilityUser.facilityId),
          eq(bookings.stylistId, stylist.id),
          gte(bookings.startTime, weekStart),
          lte(bookings.startTime, weekEnd),
        ),
        with: { resident: true, service: true },
        orderBy: (t, { asc }) => [asc(t.startTime)],
      })

      // This month's earnings
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

      const monthBookings = await db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facilityUser.facilityId),
          eq(bookings.stylistId, stylist.id),
          gte(bookings.startTime, monthStart),
          lte(bookings.startTime, monthEnd),
          eq(bookings.status, 'completed'),
        ),
      })

      monthEarningsCents = monthBookings.reduce((sum, b) => {
        const price = b.priceCents ?? 0
        return sum + Math.round(price * (stylist!.commissionPercent / 100))
      }, 0)
    }
  }

  // Load all facility stylists for the link-selector
  const facilityStylists = await db.query.stylists.findMany({
    where: and(eq(stylists.facilityId, facilityUser.facilityId), eq(stylists.active, true)),
    orderBy: (t, { asc }) => [asc(t.name)],
  })

  return (
    <MyAccountClient
      user={{ email: user.email ?? '', fullName: user.user_metadata?.full_name ?? null }}
      stylist={stylist ? JSON.parse(JSON.stringify(stylist)) : null}
      weekBookings={JSON.parse(JSON.stringify(weekBookings))}
      monthEarningsCents={monthEarningsCents}
      linked={!!profile?.stylistId}
      facilityStylists={JSON.parse(JSON.stringify(facilityStylists))}
      googleCalendarConnected={!!(stylist?.googleCalendarId)}
    />
  )
}
