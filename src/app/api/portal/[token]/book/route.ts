import { db } from '@/db'
import { residents, bookings, services, facilities, stylists } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { sendEmail, buildBookingConfirmationEmailHtml } from '@/lib/email'

const bookSchema = z.object({
  serviceId: z.string().uuid(),
  stylistId: z.string().uuid(),
  startTime: z.string().datetime(),
})

export async function POST(
  request: NextRequest,
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

    const body = await request.json()
    const parsed = bookSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { serviceId, stylistId, startTime } = parsed.data

    const service = await db.query.services.findFirst({
      where: eq(services.id, serviceId),
    })

    if (!service) {
      return Response.json({ error: 'Service not found' }, { status: 404 })
    }

    const start = new Date(startTime)
    const end = new Date(start.getTime() + service.durationMinutes * 60 * 1000)

    const [created] = await db
      .insert(bookings)
      .values({
        facilityId: resident.facilityId,
        residentId: resident.id,
        stylistId,
        serviceId,
        startTime: start,
        endTime: end,
        priceCents: service.priceCents,
        durationMinutes: service.durationMinutes,
        status: 'scheduled',
        paymentStatus: 'unpaid',
      })
      .returning()

    // POA booking confirmation — fire-and-forget
    if (resident.poaEmail && resident.portalToken) {
      const [facility, stylist] = await Promise.all([
        db.query.facilities.findFirst({ where: eq(facilities.id, resident.facilityId) }),
        db.query.stylists.findFirst({ where: eq(stylists.id, stylistId) }),
      ])
      const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${resident.portalToken}`
      const tz = facility?.timezone ?? 'America/New_York'
      const poaDateStr = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: tz })
      const poaTimeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })
      const poaHtml = buildBookingConfirmationEmailHtml({
        residentName: resident.name,
        serviceName: service.name,
        stylistName: stylist?.name ?? 'Stylist',
        dateStr: poaDateStr,
        timeStr: poaTimeStr,
        priceStr: `$${(service.priceCents / 100).toFixed(2)}`,
        facilityName: facility?.name ?? 'Senior Stylist',
        portalUrl,
        bookedBy: 'portal',
      })
      sendEmail({ to: resident.poaEmail, subject: `Appointment confirmed for ${resident.name}`, html: poaHtml }).catch(console.error)
    }

    return Response.json({ data: JSON.parse(JSON.stringify(created)) }, { status: 201 })
  } catch (err) {
    console.error('POST /api/portal/[token]/book error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
