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
import { getPlatformStripe, paymentsBlocked } from '@/lib/payments/stripe-client'

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
  // P54 — signup wizard payment step (see setup-intent route).
  signupToken: z.string().min(1).max(200).optional(),
  // P54 — the signup card save auto-enables per-visit autopay (owner decision:
  // charge after each service). Honored ONLY for portal/signup actors, backed
  // by the shared family-enable helper (requires-card guard + consent email).
  enableAutopay: z.boolean().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const parsed = postSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const auth = await authorizeResidentPayment(parsed.data.residentId, { signupToken: parsed.data.signupToken })
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    const rl = await checkRateLimit('paymentSetup', auth.actor.rateKey)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    // P53 — mirror the setup-intent gate: live key + flag off must not vault.
    if (paymentsBlocked()) {
      return Response.json({ error: 'Card payments are not turned on yet — please call the salon.' }, { status: 503 })
    }

    const saved = await saveCardFromSetupIntent(parsed.data.setupIntentId, {
      residentId: auth.actor.residentId,
      facilityId: auth.actor.facilityId,
      createdBy: auth.actor.via === 'portal' || auth.actor.via === 'signup' ? null : auth.actor.actorId,
    })

    // P54 — signup-card-save auto-enables per-visit autopay; family actors only
    // (staff/stylist requests never carry the flag through this branch).
    let autopayEnabled = false
    if (
      parsed.data.enableAutopay === true &&
      (auth.actor.via === 'portal' || auth.actor.via === 'signup')
    ) {
      const { enableFamilyAutopay } = await import('@/lib/payments/autopay-enable')
      const enabled = await enableFamilyAutopay(auth.actor.residentId)
      autopayEnabled = enabled.ok
      if (!enabled.ok) console.error('[payments.methods] signup autopay enable failed:', enabled.error)
    }

    // P54 — the token is single-use: consume on SAVE success (not on
    // setup-intent create, so a declined first card can retry in-window).
    if (auth.actor.via === 'signup' && parsed.data.signupToken) {
      const { consumeSignupCardToken } = await import('@/lib/signup-card-token')
      await consumeSignupCardToken(parsed.data.signupToken)
    }

    // P50 — card-added security notice to the family (poaEmail ∪ linked portal
    // accounts). Fire-and-forget on purpose: it's a notice; a mail failure must
    // not fail the vault. Not gated on the email-reminders preference.
    const actor = auth.actor
    void (async () => {
      const [{ sendEmail, buildCardAddedEmailHtml }, { sendSms, buildCardAddedSms }, { getFamilyRecipients }] =
        await Promise.all([import('@/lib/email'), import('@/lib/sms'), import('@/lib/portal-recipients')])
      const [recipients, facility] = await Promise.all([
        getFamilyRecipients(actor.residentId),
        db.query.facilities.findFirst({ where: (f, { eq: eqOp }) => eqOp(f.id, actor.facilityId), columns: { name: true } }),
      ])
      if (!recipients) return
      const facilityName = facility?.name ?? 'Senior Stylist'
      if (recipients.emails.length > 0) {
        const cardLabel = saved?.brand ? `${saved.brand.toUpperCase()} ••${saved.last4 ?? ''}` : 'a card'
        const html = buildCardAddedEmailHtml({
          residentName: actor.residentName,
          facilityName,
          cardLabel,
          addedVia: actor.via === 'portal' || actor.via === 'signup' ? 'portal' : 'staff',
        })
        await Promise.all(
          recipients.emails.map((to) =>
            sendEmail({
              to,
              subject: `Card saved for ${actor.residentName} — ${facilityName}`,
              html,
            }).catch(() => false),
          ),
        )
      } else if (recipients.phones.length > 0) {
        // P55 — phone-only families still get the "wasn't you?" notice, by
        // text (dormant no-op until Twilio is live).
        const smsBody = buildCardAddedSms({ residentName: actor.residentName, facilityName })
        for (const phone of recipients.phones) {
          sendSms(phone, smsBody).catch(() => {})
        }
      }
    })().catch((err) => console.error('[payments.methods] card-added notice failed:', err))

    return Response.json({ data: { card: saved, autopayEnabled } })
  } catch (err) {
    console.error('POST /api/payments/methods error:', err)
    return Response.json({ error: 'Could not save card' }, { status: 500 })
  }
}

const deleteSchema = z.object({
  residentId: z.string().uuid(),
  paymentMethodId: z.string().uuid(),
})

// P36 — "Make main card": sets is_default on one active card (clears the rest).
// Same dual portal/staff authorization as the other handlers; autopay + the
// collect engine charge the default card.
export async function PATCH(request: NextRequest) {
  try {
    const parsed = deleteSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const auth = await authorizeResidentPayment(parsed.data.residentId)
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
    // P50 — stylists vault cards only; make-default drives autopay (staff/family).
    if (auth.actor.via === 'stylist') return Response.json({ error: 'Forbidden' }, { status: 403 })

    await ensurePaymentsSchema()
    const card = await db.query.paymentMethods.findFirst({
      where: and(
        eq(paymentMethods.id, parsed.data.paymentMethodId),
        eq(paymentMethods.residentId, auth.actor.residentId),
        eq(paymentMethods.active, true),
      ),
      columns: { id: true },
    })
    if (!card) return Response.json({ error: 'Not found' }, { status: 404 })

    await db
      .update(paymentMethods)
      .set({ isDefault: false })
      .where(eq(paymentMethods.residentId, auth.actor.residentId))
    await db.update(paymentMethods).set({ isDefault: true }).where(eq(paymentMethods.id, card.id))

    return Response.json({ data: { defaultSet: true } })
  } catch (err) {
    console.error('PATCH /api/payments/methods error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {

  try {
    const parsed = deleteSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const auth = await authorizeResidentPayment(parsed.data.residentId)
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
    // P50 — removing a family's card is an admin/family action, never a stylist's.
    if (auth.actor.via === 'stylist') return Response.json({ error: 'Forbidden' }, { status: 403 })

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
