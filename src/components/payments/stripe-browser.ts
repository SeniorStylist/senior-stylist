// Shared browser-side Stripe.js loader. Caches the singleton per publishable key
// so Elements mounts across the app reuse one Stripe.js instance.

import { loadStripe, type Stripe } from '@stripe/stripe-js'

let cache: { key: string; promise: Promise<Stripe | null> } | null = null

export function getStripePromise(key: string): Promise<Stripe | null> {
  if (!cache || cache.key !== key) {
    cache = { key, promise: loadStripe(key) }
  }
  return cache.promise
}
