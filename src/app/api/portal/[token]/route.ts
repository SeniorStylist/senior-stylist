import { db } from '@/db'
import { residents, bookings } from '@/db/schema'
import { eq, gte, lt, ne } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const resident = await db.query.residents.findFirst({
      where: eq(residents.portalToken, token),
    })

    if (!resident) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const now = new Date()

    const [upcomingBookings, pastBookings] = await Promise.all([
      db.query.bookings.findMany({
        where: (b, { and, eq: eqFn, gte: gteFn, ne: neFn }) =>
          and(
            eqFn(b.residentId, resident.id),
            gteFn(b.startTime, now),
            neFn(b.status, 'cancelled')
          ),
        with: { service: true, stylist: true },
        orderBy: (t, { asc }) => [asc(t.startTime)],
      }),
      db.query.bookings.findMany({
        where: (b, { and, eq: eqFn, lt: ltFn }) =>
          and(eqFn(b.residentId, resident.id), ltFn(b.startTime, now)),
        with: { service: true, stylist: true },
        orderBy: (t, { desc }) => [desc(t.startTime)],
        limit: 10,
      }),
    ])

    return Response.json({
      data: {
        resident: {
          id: resident.id,
          name: resident.name,
          roomNumber: resident.roomNumber,
          facilityId: resident.facilityId,
        },
        upcomingBookings: JSON.parse(JSON.stringify(upcomingBookings)),
        pastBookings: JSON.parse(JSON.stringify(pastBookings)),
      },
    })
  } catch (err) {
    console.error('GET /api/portal/[token] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
