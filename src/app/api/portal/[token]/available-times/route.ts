import { db } from '@/db'
import { residents, bookings } from '@/db/schema'
import { eq, and, ne, gte, lt } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') // YYYY-MM-DD

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: 'Invalid date' }, { status: 400 })
    }

    const resident = await db.query.residents.findFirst({
      where: eq(residents.portalToken, token),
      columns: { id: true, facilityId: true },
    })

    if (!resident) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const dayStart = new Date(date + 'T00:00:00.000Z')
    const dayEnd = new Date(date + 'T23:59:59.999Z')

    const bookedAppointments = await db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, resident.facilityId),
        ne(bookings.status, 'cancelled'),
        gte(bookings.startTime, dayStart),
        lt(bookings.startTime, dayEnd)
      ),
      columns: { startTime: true },
    })

    const takenSlots = bookedAppointments.map((b) => {
      const d = new Date(b.startTime)
      const h = String(d.getUTCHours()).padStart(2, '0')
      const m = String(d.getUTCMinutes()).padStart(2, '0')
      return `${h}:${m}`
    })

    return Response.json({ takenSlots })
  } catch (err) {
    console.error('GET /api/portal/[token]/available-times error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
