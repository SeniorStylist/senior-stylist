import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { facilities, residents } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getPortalSession } from '@/lib/portal-auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { fuzzyScore } from '@/lib/fuzzy'

export const dynamic = 'force-dynamic'

const schema = z.object({
  facilityCode: z.string().min(1).max(40),
  recipientName: z.string().trim().min(2).max(200),
  recipientRoom: z.string().trim().max(50).optional(),
  amountCents: z.number().int().min(50).max(10_000_000),
  gifterName: z.string().trim().max(200).optional(),
})

const normRoom = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase()

export async function POST(request: NextRequest) {
  try {
    const session = await getPortalSession()
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('portalCheckout', session.portalAccountId)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })
    const { facilityCode, recipientName, recipientRoom, amountCents, gifterName } = parsed.data

    // Gifter must have access at this facility.
    const myResident = session.residents.find((r) => r.facilityCode === facilityCode)
    if (!myResident) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const facilityId = myResident.facilityId

    // Resolve the recipient by name (+ room) WITHOUT exposing the roster.
    const all = await db.query.residents.findMany({
      where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
      columns: { id: true, name: true, roomNumber: true },
    })
    let pool = all
    if (recipientRoom) {
      const rn = normRoom(recipientRoom)
      const byRoom = all.filter((r) => normRoom(r.roomNumber) === rn)
      if (byRoom.length) pool = byRoom
    }
    const scored = pool
      .map((r) => ({ r, score: fuzzyScore(r.name, recipientName) }))
      .sort((a, b) => b.score - a.score)
    const best = scored[0]
    const second = scored[1]
    // Require a confident, unambiguous match. With a room filter we can be lenient;
    // without one, demand a strong score and a clear gap to the runner-up.
    const ok = best && (recipientRoom ? best.score >= 0.5 : best.score >= 0.85 && (!second || second.score < 0.7))
    if (!ok) {
      return Response.json(
        { error: 'We couldn’t identify that resident. Double-check the name and room number.' },
        { status: 409 },
      )
    }
    const recipient = best.r

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { id: true, facilityCode: true, stripeSecretKey: true },
    })
    if (!facility?.facilityCode) return Response.json({ error: 'Facility misconfigured' }, { status: 500 })

    const stripeKey = facility.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY
    if (!stripeKey) return Response.json({ error: 'Online payment not configured for this facility' }, { status: 501 })

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
            product_data: { name: `Gift credit for ${recipient.name}` },
          },
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/family/${encodeURIComponent(facility.facilityCode)}/billing?gift=success`,
      cancel_url: `${appUrl}/family/${encodeURIComponent(facility.facilityCode)}/billing`,
      metadata: {
        type: 'portal_gift',
        residentId: recipient.id, // the RECIPIENT — the credit lands here
        residentName: recipient.name,
        facilityId: facility.id,
        facilityCode: facility.facilityCode,
        portalAccountId: session.portalAccountId,
        gifterName: gifterName || session.email,
      },
      customer_email: session.email,
    })

    return Response.json({ data: { checkoutUrl: checkoutSession.url, recipientName: recipient.name } })
  } catch (err) {
    console.error('POST /api/portal/gift/create-checkout error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
