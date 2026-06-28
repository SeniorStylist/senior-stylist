// Begin saving a card: create (or reuse) the resident's Stripe Customer and a
// SetupIntent, return the client_secret for the Stripe Elements card form.
// Auth: family-portal POA (own resident) OR billing staff. Charges nothing —
// SetupIntent only vaults the card for future off-session (COF) charges.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { authorizeResidentPayment } from '@/lib/payments/authorize'
import { ensureStripeCustomer } from '@/lib/payments/customer'
import { getPlatformStripe, platformPublishableKey } from '@/lib/payments/stripe-client'

export const dynamic = 'force-dynamic'

const schema = z.object({ residentId: z.string().uuid() })

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const auth = await authorizeResidentPayment(parsed.data.residentId)
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const rl = await checkRateLimit('paymentSetup', auth.actor.rateKey)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const publishableKey = platformPublishableKey()
    const stripe = await getPlatformStripe()
    if (!stripe || !publishableKey) {
      return Response.json({ error: 'Card payments are not configured' }, { status: 501 })
    }

    const customerId = await ensureStripeCustomer({
      id: auth.actor.residentId,
      name: auth.actor.residentName,
      facilityId: auth.actor.facilityId,
      poaEmail: auth.actor.poaEmail,
      stripeCustomerId: auth.actor.stripeCustomerId,
    })

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: {
        residentId: auth.actor.residentId,
        facilityId: auth.actor.facilityId,
        createdBy: auth.actor.via === 'admin' ? auth.actor.actorId : '',
      },
    })

    return Response.json({
      data: { clientSecret: setupIntent.client_secret, publishableKey, customerId },
    })
  } catch (err) {
    console.error('POST /api/payments/setup-intent error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
