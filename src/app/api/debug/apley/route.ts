// APLEY — the Debug tab's end-to-end demo launcher.
//
// `start` builds (or repairs) the Apley world and reports what the environment
// will actually let the walk prove; `reset` removes it so the demo can be run
// again from scratch in front of someone.
//
// Master-email gated, like every other route under /api/debug.

import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { buildApleyWorld, teardownApleyWorld, APLEY_CODE } from '@/lib/demo/apley'
import { platformPublishableKey, platformStripeKey, paymentsBlocked } from '@/lib/payments/stripe-client'

export const dynamic = 'force-dynamic'
// The world build is a dozen sequential writes through the max:1 pool, and the
// teardown is a FK-ordered chain of deletes. Neither is close to 10s, but the
// platform default would be an unpleasant surprise on a cold connection.
export const maxDuration = 60

const schema = z.object({ action: z.enum(['start', 'reset']) })

/**
 * What the card step can honestly do in THIS environment.
 *
 * The walk shows this verbatim rather than assuming, because a demo that claims
 * to have charged a card when it did not is worse than one that says it cannot.
 */
function cardMode(): { mode: 'test' | 'live_blocked' | 'live' | 'unconfigured'; note: string } {
  const secret = platformStripeKey()
  const publishable = platformPublishableKey()
  if (!secret || !publishable) {
    return {
      mode: 'unconfigured',
      note: 'Stripe keys are not set in this environment, so Apley will skip the card and the charge, and say so on screen.',
    }
  }
  if (secret.startsWith('sk_test_')) {
    return {
      mode: 'test',
      note: 'Stripe is in test mode. Use card 4242 4242 4242 4242 with any future expiry, any CVC, any ZIP. A real Stripe test-mode charge is created; no money moves.',
    }
  }
  if (paymentsBlocked()) {
    return {
      mode: 'live_blocked',
      note: 'Live Stripe keys are present but payments are switched off, so card vaulting is blocked. Apley will skip the card step.',
    }
  }
  // Live keys with payments on: demoChargesAllowed() is false by construction,
  // so the walk must not pretend the charge will fire.
  return {
    mode: 'live',
    note: 'Stripe is LIVE. Apley never charges with a live key — the card and charge steps are skipped. Run the demo against test keys to see the money path.',
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'action must be start or reset' }, { status: 422 })

    const cookieStore = await cookies()

    if (parsed.data.action === 'reset') {
      const result = await teardownApleyWorld()
      // A debug role pinned to the facility we just deleted would leave the
      // master impersonating a stylist at a facility that no longer exists.
      cookieStore.delete('__debug_role')
      revalidateTag('facilities', {})
      return Response.json({ data: { reset: true, ...result } })
    }

    const world = await buildApleyWorld(user.id)
    // Impersonate the Apley stylist for the WHOLE walk rather than switching
    // identity halfway. The family half does not care — the portal resolves the
    // demo facility from the master's Supabase session (isMasterSession), which
    // the debug cookie does not affect — and the staff half then lands already
    // scoped to Apley as the stylist who owns the work. That removes the one
    // genuinely fragile thing about a cross-role walk: a hard reload in the
    // middle of it, with the tour's place kept only in sessionStorage.
    cookieStore.set(
      '__debug_role',
      JSON.stringify({
        role: 'stylist',
        facilityId: world.facilityId,
        facilityName: world.facilityName,
        stylistId: world.stylistId,
      }),
      { httpOnly: false, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 8 },
    )
    // The switcher's membership list is cached (P31) — without this the new
    // facility is invisible in the corner until the cache expires.
    revalidateTag('facilities', {})

    const card = cardMode()
    return Response.json({
      data: {
        ...world,
        signupUrl: `/family/${APLEY_CODE}/signup`,
        card,
        // Twilio is independent of Stripe and usually dormant; the walk says so
        // rather than letting someone conclude texts are broken.
        smsEnabled: process.env.TWILIO_ENABLED === 'true',
      },
    })
  } catch (err) {
    console.error('POST /api/debug/apley error:', err)
    return Response.json({ error: 'Could not prepare the Apley demo' }, { status: 500 })
  }
}
