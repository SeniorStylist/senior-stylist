// P55 — public gift-link checkout. Anyone holding the shared link can send a
// gift credit for ONE resident without seeing any account information (no
// room, balance, appointments, or contact details). The token is
// residents.portalToken — semi-public by design once shared, which is exactly
// why the legacy data-serving /api/portal/[token]/* routes were retired in
// the same commit this shipped in.
//
// Money flow: Stripe Checkout with metadata.type='portal_gift' → the existing
// webhook handlePortalCredit banks a qb_unapplied_credits row on the
// recipient (PI-unique insert-first idempotency; zero webhook changes).

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { facilities, residents } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const schema = z.object({
  // Public-link cap: $5–$500 (the in-portal gift flow keeps its own limits).
  amountCents: z.number().int().min(500).max(50_000),
  gifterName: z.string().trim().max(200).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    if (!token || token.length > 200) return Response.json({ error: 'Not found' }, { status: 404 })

    // Public card-testing surface: limit per-token AND per-IP.
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const rlToken = await checkRateLimit('portalCheckout', `gift:${token}`)
    if (!rlToken.ok) return rateLimitResponse(rlToken.retryAfter)
    const rlIp = await checkRateLimit('portalCheckout', `giftip:${ip}`)
    if (!rlIp.ok) return rateLimitResponse(rlIp.retryAfter)

    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const resident = await db.query.residents.findFirst({
      where: and(eq(residents.portalToken, token), eq(residents.active, true), eq(residents.isDemo, false)),
      columns: { id: true, name: true, facilityId: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    const facility = await db.query.facilities.findFirst({
      where: and(eq(facilities.id, resident.facilityId), eq(facilities.active, true), eq(facilities.isDemo, false)),
      columns: { id: true, facilityCode: true, name: true },
    })
    if (!facility) return Response.json({ error: 'Not found' }, { status: 404 })

    // P53 — platform key only + loud block while live payments are off.
    const { getPlatformStripe, paymentsBlocked } = await import('@/lib/payments/stripe-client')
    const stripe = await getPlatformStripe()
    if (!stripe) return Response.json({ error: 'Online payment is not set up yet — please call the salon.' }, { status: 501 })
    if (paymentsBlocked()) {
      return Response.json({ error: 'Online payment is not turned on yet — please call the salon.' }, { status: 503 })
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://portal.seniorstylist.com').replace(/\/$/, '')
    const firstName = resident.name.trim().split(/\s+/)[0] || 'a resident'

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: parsed.data.amountCents,
            // First name only — the Checkout page is shown to a possibly
            // distant relative; the roster name stays server-side in metadata.
            product_data: { name: `Salon gift credit for ${firstName}` },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/gift/${encodeURIComponent(token)}?success=1`,
      cancel_url: `${appUrl}/gift/${encodeURIComponent(token)}`,
      metadata: {
        type: 'portal_gift',
        residentId: resident.id, // the RECIPIENT — the credit lands here
        residentName: resident.name,
        facilityId: facility.id,
        facilityCode: facility.facilityCode ?? '',
        gifterName: parsed.data.gifterName || 'A friend or family member',
      },
    })

    return Response.json({ data: { checkoutUrl: checkoutSession.url } })
  } catch (err) {
    console.error('POST /api/gift/[token]/checkout error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
