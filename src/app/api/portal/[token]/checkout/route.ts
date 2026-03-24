import { db } from '@/db'
import { residents, services, facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
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

    const [service, facility] = await Promise.all([
      db.query.services.findFirst({ where: eq(services.id, serviceId) }),
      db.query.facilities.findFirst({ where: eq(facilities.id, resident.facilityId) }),
    ])

    if (!service) {
      return Response.json({ error: 'Service not found' }, { status: 404 })
    }

    const stripeKey = facility?.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY
    if (!stripeKey) {
      return Response.json({ error: 'Stripe not configured' }, { status: 503 })
    }

    // Dynamic import to keep stripe server-side only
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(stripeKey)

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
