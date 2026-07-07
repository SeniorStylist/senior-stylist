// Phase 15 F7 — Stripe Terminal connection token for Tap to Pay. The native
// Terminal SDK exchanges this for a reader session. Dormant until
// NEXT_PUBLIC_TAP_TO_PAY_ENABLED is set client-side; the route itself only
// requires Stripe keys. Auth mirrors /api/payments/intent (stylists included —
// they're the ones tapping the phone).

import { db } from '@/db'
import { profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility, isAdminOrAbove, isFacilityStaff, canAccessBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getPlatformStripe, platformStripeKey, paymentsLiveEnabled } from '@/lib/payments/stripe-client'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu) return Response.json({ error: 'No facility' }, { status: 400 })
      const allowed = isAdminOrAbove(fu.role) || isFacilityStaff(fu.role) || canAccessBilling(fu.role) || fu.role === 'stylist'
      if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (fu.role === 'stylist') {
        // Must be a linked stylist (same requirement as taking a payment)
        const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id), columns: { stylistId: true } })
        if (!profile?.stylistId) return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const rl = await checkRateLimit('paymentCollect', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const key = platformStripeKey()
    if (!key) return Response.json({ error: 'Card payments are not configured' }, { status: 501 })
    if (key.startsWith('sk_live_') && !paymentsLiveEnabled()) {
      return Response.json({ error: 'Live card payments are disabled' }, { status: 501 })
    }

    const stripe = await getPlatformStripe()
    if (!stripe) return Response.json({ error: 'Card payments are not configured' }, { status: 501 })

    const location = process.env.STRIPE_TERMINAL_LOCATION_ID
    const token = await stripe.terminal.connectionTokens.create(
      location ? { location } : {},
    )

    return Response.json({ data: { secret: token.secret } })
  } catch (err) {
    console.error('POST /api/payments/terminal/connection-token error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
