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
  // 'balance' = pay outstanding now (auto-applied FIFO in the webhook);
  // 'prepay' = add funds to the account as an unapplied credit (manual attribution).
  purpose: z.enum(['balance', 'prepay']).default('balance'),
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

    const { residentId, purpose } = parsed.data
    let amountCents = parsed.data.amountCents
    const residentMatch = session.residents.find((r) => r.residentId === residentId)
    if (!residentMatch) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, residentId),
      columns: { id: true, name: true, facilityId: true, qbOutstandingBalanceCents: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    // Safeguard (2026-07-07): a balance payment can't start when nothing is owed —
    // blocks the two-tabs / pay-twice case (the second tab's stale button 409s here).
    if (purpose === 'balance' && (resident.qbOutstandingBalanceCents ?? 0) <= 0) {
      return Response.json(
        { error: 'This balance has already been paid — refresh the page to see the updated amount.' },
        { status: 409 },
      )
    }
    // …and never charge MORE than what's currently owed (stale prefilled amount).
    if (purpose === 'balance') {
      amountCents = Math.min(amountCents, resident.qbOutstandingBalanceCents ?? amountCents)
    }

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

    const isPrepay = purpose === 'prepay'
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: isPrepay ? `Account credit for ${resident.name}` : `Balance payment for ${resident.name}`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/family/${encodeURIComponent(facility.facilityCode)}/billing?payment=success`,
      cancel_url: `${appUrl}/family/${encodeURIComponent(facility.facilityCode)}/billing`,
      metadata: {
        type: isPrepay ? 'portal_prepay' : 'portal_balance',
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
