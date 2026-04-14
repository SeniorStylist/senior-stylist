import { db } from '@/db'
import { residents, bookings, facilities } from '@/db/schema'
import { eq, gte, lt, ne } from 'drizzle-orm'
import { toClientJson } from '@/lib/sanitize'
import { NextRequest } from 'next/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const resident = await db.query.residents.findFirst({
      where: eq(residents.portalToken, token),
      columns: {
        id: true,
        facilityId: true,
        name: true,
        roomNumber: true,
        poaName: true,
        poaEmail: true,
        poaNotificationsEnabled: true,
      },
    })

    if (!resident) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const now = new Date()

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, resident.facilityId),
      columns: { paymentType: true },
    })

    const stylistCols = {
      id: true,
      facilityId: true,
      name: true,
      color: true,
      active: true,
    } as const

    const serviceCols = {
      id: true,
      name: true,
      color: true,
      durationMinutes: true,
      priceCents: true,
      pricingType: true,
      addonAmountCents: true,
      pricingTiers: true,
      pricingOptions: true,
    } as const

    const bookingCols = {
      id: true,
      facilityId: true,
      residentId: true,
      stylistId: true,
      serviceId: true,
      serviceIds: true,
      serviceNames: true,
      startTime: true,
      endTime: true,
      durationMinutes: true,
      totalDurationMinutes: true,
      priceCents: true,
      status: true,
      paymentStatus: true,
      selectedQuantity: true,
      selectedOption: true,
      addonServiceIds: true,
      addonTotalCents: true,
      notes: true,
    } as const

    const [upcomingBookings, pastBookings] = await Promise.all([
      db.query.bookings.findMany({
        where: (b, { and, eq: eqFn, gte: gteFn, ne: neFn }) =>
          and(
            eqFn(b.residentId, resident.id),
            gteFn(b.startTime, now),
            neFn(b.status, 'cancelled')
          ),
        columns: bookingCols,
        with: { service: { columns: serviceCols }, stylist: { columns: stylistCols } },
        orderBy: (t, { asc }) => [asc(t.startTime)],
      }),
      db.query.bookings.findMany({
        where: (b, { and, eq: eqFn, lt: ltFn }) =>
          and(eqFn(b.residentId, resident.id), ltFn(b.startTime, now)),
        columns: bookingCols,
        with: { service: { columns: serviceCols }, stylist: { columns: stylistCols } },
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
          poaName: resident.poaName,
          poaEmail: resident.poaEmail,
          poaNotificationsEnabled: resident.poaNotificationsEnabled,
        },
        facilityPaymentType: facility?.paymentType ?? 'facility',
        upcomingBookings: toClientJson(upcomingBookings),
        pastBookings: toClientJson(pastBookings),
      },
    })
  } catch (err) {
    console.error('GET /api/portal/[token] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
