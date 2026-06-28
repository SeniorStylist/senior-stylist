// Saved-card management for a resident (Card-On-File).
//   GET    ?residentId=…           → list active saved cards (display fields only)
//   POST   { residentId, setupIntentId } → persist a card after client-side confirm
//   DELETE { residentId, paymentMethodId } → soft-remove + detach from Stripe
// Auth: family-portal POA (own resident) OR billing staff. Tokens only — never PAN.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { paymentMethods } from '@/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { authorizeResidentPayment } from '@/lib/payments/authorize'
import { saveCardFromSetupIntent } from '@/lib/payments/methods'
import { ensurePaymentsSchema } from '@/lib/payments-ddl'
import { getPlatformStripe } from '@/lib/payments/stripe-client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const residentId = request.nextUrl.searchParams.get('residentId')
    if (!residentId) return Response.json({ error: 'residentId required' }, { status: 422 })

    const auth = await authorizeResidentPayment(residentId)
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    await ensurePaymentsSchema()
    const cards = await db
      .select({
        id: paymentMethods.id,
        brand: paymentMethods.brand,
        last4: paymentMethods.last4,
        expMonth: paymentMethods.expMonth,
        expYear: paymentMethods.expYear,
        isDefault: paymentMethods.isDefault,
      })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.residentId, residentId), eq(paymentMethods.active, true)))
      .orderBy(desc(paymentMethods.isDefault), desc(paymentMethods.createdAt))

    return Response.json({ data: { cards } })
  } catch (err) {
    console.error('GET /api/payments/methods error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const postSchema = z.object({
  residentId: z.string().uuid(),
  setupIntentId: z.string().min(1).max(200),
})

export async function POST(request: NextRequest) {
  try {
    const parsed = postSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const auth = await authorizeResidentPayment(parsed.data.residentId)
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const rl = await checkRateLimit('paymentSetup', auth.actor.rateKey)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const saved = await saveCardFromSetupIntent(parsed.data.setupIntentId, {
      residentId: auth.actor.residentId,
      facilityId: auth.actor.facilityId,
      createdBy: auth.actor.via === 'admin' ? auth.actor.actorId : null,
    })

    return Response.json({ data: { card: saved } })
  } catch (err) {
    console.error('POST /api/payments/methods error:', err)
    return Response.json({ error: 'Could not save card' }, { status: 500 })
  }
}

const deleteSchema = z.object({
  residentId: z.string().uuid(),
  paymentMethodId: z.string().uuid(),
})

export async function DELETE(request: NextRequest) {
  try {
    const parsed = deleteSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const auth = await authorizeResidentPayment(parsed.data.residentId)
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    await ensurePaymentsSchema()
    const card = await db.query.paymentMethods.findFirst({
      where: and(
        eq(paymentMethods.id, parsed.data.paymentMethodId),
        eq(paymentMethods.residentId, auth.actor.residentId),
        eq(paymentMethods.active, true),
      ),
      columns: { id: true, stripePaymentMethodId: true, isDefault: true },
    })
    if (!card) return Response.json({ error: 'Not found' }, { status: 404 })

    await db
      .update(paymentMethods)
      .set({ active: false, isDefault: false })
      .where(eq(paymentMethods.id, card.id))

    // If we removed the default, promote the next active card.
    if (card.isDefault) {
      const next = await db.query.paymentMethods.findFirst({
        where: and(eq(paymentMethods.residentId, auth.actor.residentId), eq(paymentMethods.active, true)),
        orderBy: [desc(paymentMethods.createdAt)],
        columns: { id: true },
      })
      if (next) {
        await db.update(paymentMethods).set({ isDefault: true }).where(eq(paymentMethods.id, next.id))
      }
    }

    // Best-effort detach from Stripe (don't fail the request if it errors).
    try {
      const stripe = await getPlatformStripe()
      if (stripe) await stripe.paymentMethods.detach(card.stripePaymentMethodId)
    } catch (e) {
      console.error('[payments.methods] stripe detach failed (soft-deleted locally):', e)
    }

    return Response.json({ data: { removed: true } })
  } catch (err) {
    console.error('DELETE /api/payments/methods error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
