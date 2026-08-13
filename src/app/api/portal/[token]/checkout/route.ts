import { db } from '@/db'
import { residents, services, bookings } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const checkoutSchema = z.object({
  bookingId: z.string().uuid(),
  serviceId: z.string().uuid(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params

    const resident = await db.query.residents.findFirst({
      where: eq(residents.portalToken, token),
      columns: { id: true, facilityId: true },
    })

    if (!resident) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = checkoutSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { bookingId, serviceId } = parsed.data

    // The webhook marks metadata.bookingId as paid — validate the booking belongs
    // to THIS resident before creating the session (a forged UUID would otherwise
    // let a token holder flip any booking in any facility to paid).
    const booking = await db.query.bookings.findFirst({
      where: and(
        eq(bookings.id, bookingId),
        eq(bookings.residentId, resident.id),
        eq(bookings.facilityId, resident.facilityId),
      ),
      columns: { id: true },
    })
    if (!booking) {
      return Response.json({ error: 'Booking not found' }, { status: 404 })
    }

    const service = await db.query.services.findFirst({
      where: and(eq(services.id, serviceId), eq(services.facilityId, resident.facilityId)),
      columns: { id: true, name: true, priceCents: true },
    })

    if (!service) {
      return Response.json({ error: 'Service not found' }, { status: 404 })
    }

    // P53 — platform key only (facility-key checkout produced webhook events
    // our platform signing secret rejects — charged but never recorded).
    const { getPlatformStripe, paymentsBlocked } = await import('@/lib/payments/stripe-client')
    const stripe = await getPlatformStripe()
    if (!stripe) {
      return Response.json({ error: 'Stripe not configured' }, { status: 503 })
    }
    if (paymentsBlocked()) {
      return Response.json({ error: 'Online payment is not turned on yet — please call the salon.' }, { status: 503 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://senior-stylist.vercel.app'

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: service.priceCents,
            product_data: { name: service.name },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/portal/${token}?paid=true`,
      cancel_url: `${appUrl}/portal/${token}`,
      metadata: {
        bookingId,
        residentId: resident.id,
        facilityId: resident.facilityId,
      },
    })

    return Response.json({ url: session.url })
  } catch (err) {
    console.error('POST /api/portal/[token]/checkout error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
