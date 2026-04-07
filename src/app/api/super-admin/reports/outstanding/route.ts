export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities, services } from '@/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { unstable_cache } from 'next/cache'
import { getSuperAdminFacilities } from '@/lib/get-super-admin-facilities'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityIds = await getSuperAdminFacilities(user.id, user.email ?? '')
    if (facilityIds.length === 0) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const cacheKey = `super-admin-outstanding-${[...facilityIds].sort().join(',')}`

    const fetcher = unstable_cache(
      async () => {
        // Fetch facilities map for name lookup
        const facilitiesList = await db
          .select({ id: facilities.id, name: facilities.name })
          .from(facilities)
          .where(inArray(facilities.id, facilityIds))
        const facilityMap = new Map(facilitiesList.map((f) => [f.id, f.name]))

        const rows = await db.query.bookings.findMany({
          where: and(
            inArray(bookings.facilityId, facilityIds),
            eq(bookings.status, 'completed'),
            eq(bookings.paymentStatus, 'unpaid')
          ),
          with: {
            resident: { columns: { id: true, name: true, roomNumber: true } },
            stylist: { columns: { id: true, name: true } },
            service: { columns: { id: true, name: true, priceCents: true } },
          },
          orderBy: (t, { asc, desc }) => [asc(t.facilityId), desc(t.startTime)],
        })

        return rows.map((b) => ({
          id: b.id,
          facilityId: b.facilityId,
          facilityName: facilityMap.get(b.facilityId) ?? '',
          startTime: b.startTime.toISOString(),
          effectivePriceCents: b.priceCents ?? b.service.priceCents,
          resident: { name: b.resident.name, roomNumber: b.resident.roomNumber },
          stylist: { name: b.stylist.name },
          service: { name: b.service.name },
        }))
      },
      [cacheKey],
      { revalidate: 300, tags: ['bookings'] }
    )

    const data = await fetcher()
    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/super-admin/reports/outstanding error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
