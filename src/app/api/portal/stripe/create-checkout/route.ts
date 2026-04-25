import { db } from '@/db'
import { facilities, residents } from '@/db/schema'
import { getPortalSession } from '@/lib/portal-auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  residentId: z.string().uuid(),
  amountCents: z.number().int().min(50).max(10_000_000),
})

export async function POST(request: NextRequest) {
  try {
    const session = await getPortalSession()
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('portalCheckout', session.portalAccountId)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const { residentId, amountCents } = parsed.data
    const residentMatch = session.residents.find((r) => r.residentId === residentId)
    if (!residentMatch) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, residentId),
      columns: { id: true, name: true, facilityId: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, resident.facilityId),
      columns: { id: true, facilityCode: true, stripeSecretKey: true },
    })
    if (!facility?.facilityCode) return Response.json({ error: 'Facility misconfigured' }, { status: 500 })

    const stripeKey = facility.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY
    if (!stripeKey) {
      return Response.json({ error: 'Online payment not configured for this facility' }, { status: 501 })
    }

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(stripeKey)
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://senior-stylist.vercel.app').replace(/\/$/, '')

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: { name: `Balance payment for ${resident.name}` },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/family/${encodeURIComponent(facility.facilityCode)}/billing?payment=success`,
      cancel_url: `${appUrl}/family/${encodeURIComponent(facility.facilityCode)}/billing`,
      metadata: {
        type: 'portal_balance',
        residentId: resident.id,
        residentName: resident.name,
        facilityId: facility.id,
        facilityCode: facility.facilityCode,
        portalAccountId: session.portalAccountId,
      },
      customer_email: session.email,
    })

    return Response.json({ data: { checkoutUrl: checkoutSession.url } })
  } catch (err) {
    console.error('POST /api/portal/stripe/create-checkout error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
