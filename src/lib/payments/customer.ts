// Find-or-create the Stripe Customer that holds a resident's saved cards.
// One Customer per resident, id cached on residents.stripe_customer_id.

import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { ensurePaymentsSchema } from '@/lib/payments-ddl'
import { getPlatformStripe } from './stripe-client'

export interface ResidentCustomerContext {
  id: string
  name: string
  facilityId: string
  poaEmail: string | null
  stripeCustomerId: string | null
}

/**
 * Returns the resident's Stripe Customer id, creating the Customer (and persisting
 * the id) on first use. Throws if Stripe is not configured — callers should guard
 * with platformStripeKey()/getPlatformStripe() and surface a 501.
 */
export async function ensureStripeCustomer(resident: ResidentCustomerContext): Promise<string> {
  if (resident.stripeCustomerId) return resident.stripeCustomerId

  const stripe = await getPlatformStripe()
  if (!stripe) throw new Error('Stripe platform account not configured')

  const customer = await stripe.customers.create({
    name: resident.name,
    email: resident.poaEmail ?? undefined,
    metadata: { residentId: resident.id, facilityId: resident.facilityId },
  })

  await ensurePaymentsSchema()
  await db
    .update(residents)
    .set({ stripeCustomerId: customer.id, updatedAt: new Date() })
    .where(eq(residents.id, resident.id))

  return customer.id
}
