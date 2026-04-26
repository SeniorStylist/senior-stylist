import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings } from '@/db/schema'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { and, eq, gte, lt } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!canAccessBilling(facilityUser.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month')

    let whereClause
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [year, mon] = month.split('-').map(Number)
      const start = new Date(year, mon - 1, 1)
      const end = new Date(year, mon, 1)
      whereClause = and(
        eq(bookings.facilityId, facilityUser.facilityId),
        eq(bookings.status, 'completed'),
        gte(bookings.startTime, start),
        lt(bookings.startTime, end)
      )
    } else {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      whereClause = and(
        eq(bookings.facilityId, facilityUser.facilityId),
        eq(bookings.status, 'completed'),
        gte(bookings.startTime, start),
        lt(bookings.startTime, end)
      )
    }

    const rows = await db.query.bookings.findMany({
      where: whereClause,
      with: {
        resident: true,
        service: true,
        stylist: true,
      },
      orderBy: (t, { asc }) => [asc(t.startTime)],
    })

    const data = rows.map((b) => ({
      id: b.id,
      startTime: b.startTime,
      residentId: b.residentId,
      residentName: b.resident.name,
      residentRoom: b.resident.roomNumber,
      service: b.service.name,
      stylist: b.stylist.name,
      priceCents: b.priceCents ?? 0,
      paymentStatus: b.paymentStatus,
    }))

    return Response.json({ data: { bookings: JSON.parse(JSON.stringify(data)) } })
  } catch (err) {
    console.error('GET /api/reports/invoice error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
