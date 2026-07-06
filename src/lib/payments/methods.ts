// Persist a saved card from a completed Stripe SetupIntent. Shared by the
// POST /api/payments/methods route (instant, after client-side confirm) and the
// setup_intent.succeeded webhook backstop. Idempotent via the unique index on
// stripe_payment_method_id.

import { db } from '@/db'
import { paymentMethods, residents } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { ensurePaymentsSchema } from '@/lib/payments-ddl'
import { getPlatformStripe } from './stripe-client'

export interface SaveCardContext {
  residentId: string
  facilityId: string
  createdBy?: string | null
  isDemo?: boolean
}

/**
 * Retrieve a succeeded SetupIntent, validate it, and persist the card it vaulted.
 * Returns the stored card summary (or the existing one if already persisted).
 */
export async function saveCardFromSetupIntent(
  setupIntentId: string,
  ctx: SaveCardContext,
): Promise<{ stripePaymentMethodId: string; brand: string | null; last4: string | null }> {
  const stripe = await getPlatformStripe()
  if (!stripe) throw new Error('Stripe platform account not configured')

  const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ['payment_method'] })
  if (si.status !== 'succeeded') throw new Error('Card setup was not completed')

  const pm = si.payment_method
  if (!pm || typeof pm === 'string') throw new Error('SetupIntent has no expanded payment method')
  const customerId = typeof si.customer === 'string' ? si.customer : si.customer?.id
  if (!customerId) throw new Error('SetupIntent has no customer')

  // The SetupIntent must have been created for THIS resident — the setup-intent
  // route stamps the resident's Stripe customer, so a mismatched customer means a
  // forged/foreign setupIntentId (would vault someone else's card under this resident).
  const resident = await db.query.residents.findFirst({
    where: eq(residents.id, ctx.residentId),
    columns: { stripeCustomerId: true },
  })
  if (!resident?.stripeCustomerId || resident.stripeCustomerId !== customerId) {
    throw new Error('SetupIntent does not belong to this resident')
  }

  const brand = pm.card?.brand ?? null
  const last4 = pm.card?.last4 ?? null
  const expMonth = pm.card?.exp_month ?? null
  const expYear = pm.card?.exp_year ?? null

  await ensurePaymentsSchema()

  // First active card for this resident becomes the default.
  const existing = await db
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.residentId, ctx.residentId), eq(paymentMethods.active, true)))
  const isDefault = existing.length === 0

  await db
    .insert(paymentMethods)
    .values({
      residentId: ctx.residentId,
      facilityId: ctx.facilityId,
      stripeCustomerId: customerId,
      stripePaymentMethodId: pm.id,
      brand,
      last4,
      expMonth,
      expYear,
      isDefault,
      createdBy: ctx.createdBy ?? null,
      isDemo: ctx.isDemo ?? false,
    })
    .onConflictDoNothing({ target: paymentMethods.stripePaymentMethodId })

  return { stripePaymentMethodId: pm.id, brand, last4 }
}
