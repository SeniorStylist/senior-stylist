import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities, services } from '@/db/schema'
import { and, eq, gte, lt, inArray, sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { getSuperAdminFacilities } from '@/lib/get-super-admin-facilities'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityIds = await getSuperAdminFacilities(user.id, user.email ?? '')
    if (facilityIds.length === 0) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const monthParam = request.nextUrl.searchParams.get('month') ?? ''
    let y: number, m: number
    if (/^\d{4}-\d{2}$/.test(monthParam)) {
      ;[y, m] = monthParam.split('-').map(Number)
    } else {
      y = new Date().getUTCFullYear()
      m = new Date().getUTCMonth() + 1
    }
    const start = new Date(Date.UTC(y, m - 1, 1))
    const end = new Date(Date.UTC(y, m, 1))

    const cacheKey = `super-admin-monthly-${[...facilityIds].sort().join(',')}-${y}-${m}`

    const fetcher = unstable_cache(
      async () => {
        const facilitiesList = await db
          .select({ id: facilities.id, name: facilities.name })
          .from(facilities)
          .where(inArray(facilities.id, facilityIds))

        const result = await Promise.all(
          facilitiesList.map(async (f) => {
            const rows = await db
              .select({
                effectivePrice: sql<number>`COALESCE(${bookings.priceCents}, ${services.priceCents})`,
                paymentStatus: bookings.paymentStatus,
              })
              .from(bookings)
              .innerJoin(services, eq(bookings.serviceId, services.id))
              .where(
                and(
                  eq(bookings.facilityId, f.id),
                  eq(bookings.status, 'completed'),
                  gte(bookings.startTime, start),
                  lt(bookings.startTime, end)
                )
              )

            const appointmentCount = rows.length
            const totalRevenueCents = rows.reduce((s, b) => s + (b.effectivePrice ?? 0), 0)
            const unpaid = rows.filter((b) => b.paymentStatus === 'unpaid')
            return {
              facilityId: f.id,
              facilityName: f.name,
              appointmentCount,
              totalRevenueCents,
              unpaidCount: unpaid.length,
              unpaidRevenueCents: unpaid.reduce((s, b) => s + (b.effectivePrice ?? 0), 0),
            }
          })
        )
        return result
      },
      [cacheKey],
      { revalidate: 300, tags: ['bookings'] }
    )

    const data = await fetcher()
    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/super-admin/reports/monthly error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
