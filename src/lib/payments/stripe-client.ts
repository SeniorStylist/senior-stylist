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

/**
 * P53 — true ONLY for the dangerous combination: a LIVE key with the flag
 * still off. Before this, that state let families vault a real card and turn
 * on autopay that then silently never charged (every collection returned
 * not_configured). Test keys + flag off stay fully usable — that is the
 * documented dev/test mode.
 */
export function paymentsBlocked(): boolean {
  return (platformStripeKey()?.startsWith('sk_live_') ?? false) && !paymentsLiveEnabled()
}

/**
 * APLEY — may a DEMO record be charged?
 *
 * The charge engine refuses demo data in five places, which is right: demo
 * money must never mix with real money. But it also made the owner-facing
 * end-to-end demo impossible to complete — the whole point of that demo is to
 * prove the card is really charged and the receipt really arrives.
 *
 * The gate is the key itself. This is true ONLY for an `sk_test_` secret key,
 * so the demo-charge path is UNREACHABLE with a live key by construction —
 * not by a flag someone could flip, and not by a condition that drifts. In
 * test mode Stripe moves no money, so the worst case is a test-mode charge
 * against test-mode data.
 *
 * If you are adding a new demo guard to the charge path, use this and say so,
 * so all of them stay findable as one rule.
 */
export function demoChargesAllowed(): boolean {
  return platformStripeKey()?.startsWith('sk_test_') ?? false
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
