import { db } from '@/db'
import { bookings } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
      return Response.json({ error: 'Stripe not configured' }, { status: 503 })
    }

    const body = await request.text()
    const signature = request.headers.get('stripe-signature')

    if (!signature) {
      return Response.json({ error: 'Missing signature' }, { status: 400 })
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

    let event
    try {
      event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      console.error('Stripe webhook signature verification failed:', err)
      return Response.json({ error: 'Invalid signature' }, { status: 400 })
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const bookingId = session.metadata?.bookingId

      if (bookingId) {
        await db
          .update(bookings)
          .set({ paymentStatus: 'paid', updatedAt: new Date() })
          .where(eq(bookings.id, bookingId))
      }
    }

    return Response.json({ received: true })
  } catch (err) {
    console.error('POST /api/webhooks/stripe error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
