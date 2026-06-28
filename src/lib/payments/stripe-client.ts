// Single Senior Stylist Stripe *platform* account for all card-on-file + in-app
// collection (Josh, 2026-06-28: "deposit straight to one of our accounts").
// This is DISTINCT from the per-facility `facilities.stripeSecretKey` used by the
// family-portal one-time Checkout flow — COF/collection money lands in the SS
// platform account and rev-share is split internally (calculateRevShare).
//
// Until PAYMENTS_LIVE_ENABLED === 'true', live charging is refused so the whole
// feature is buildable/testable against Stripe test keys (mirrors TWILIO_ENABLED
// / QB_INVOICE_SYNC_ENABLED gating).

import type Stripe from 'stripe'

let cached: Stripe | null = null

/** True once Josh flips the flag in Vercel after the merchant account is approved. */
export function paymentsLiveEnabled(): boolean {
  return process.env.PAYMENTS_LIVE_ENABLED === 'true'
}

/** The platform secret key (SS account), if configured. */
export function platformStripeKey(): string | null {
  return process.env.STRIPE_SECRET_KEY ?? null
}

/** The platform publishable key surfaced to the client for Stripe Elements. */
export function platformPublishableKey(): string | null {
  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    process.env.STRIPE_PUBLISHABLE_KEY ??
    null
  )
}

/**
 * Lazily-constructed singleton Stripe client for the platform account.
 * Returns null when no secret key is configured (callers 501/503).
 */
export async function getPlatformStripe(): Promise<Stripe | null> {
  if (cached) return cached
  const key = platformStripeKey()
  if (!key) return null
  const StripeCtor = (await import('stripe')).default
  cached = new StripeCtor(key)
  return cached
}
