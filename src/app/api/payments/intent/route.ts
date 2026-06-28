// In-app card collection (Part B): create an on-session PaymentIntent the stylist
// confirms with the Stripe Payment Element. Money lands in the SS platform account;
// the payment is tied to specific booking(s). Optionally saves the card for future
// COF. Auth: admin/facility_staff/bookkeeper/master (facility scope) or a stylist
// for their OWN bookings.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { bookings, profiles, residents } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility, isAdminOrAbove, isFacilityStaff, canAccessBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { ensureStripeCustomer } from '@/lib/payments/customer'
import { getPlatformStripe, platformPublishableKey, platformStripeKey, paymentsLiveEnabled } from '@/lib/payments/stripe-client'

export const dynamic = 'force-dynamic'

const schema = z.object({
  residentId: z.string().uuid(),
  amountCents: z.number().int().min(50).max(10_000_000),
  bookingIds: z.array(z.string().uuid()).max(50).optional(),
  invoiceIds: z.array(z.string().uuid()).max(50).optional(),
  savePaymentMethod: z.boolean().default(false),
})

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })
    const body = parsed.data

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, body.residentId),
      columns: { id: true, name: true, facilityId: true, poaEmail: true, stripeCustomerId: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu) return Response.json({ error: 'No facility' }, { status: 400 })
      const billingOrStaff = isAdminOrAbove(fu.role) || isFacilityStaff(fu.role) || canAccessBilling(fu.role)
      if (billingOrStaff) {
        // bookkeeper is cross-facility; everyone else is scoped to their facility.
        if (fu.role !== 'bookkeeper' && fu.facilityId !== resident.facilityId) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }
      } else if (fu.role === 'stylist') {
        // Stylists may only collect for their own bookings — require + verify ownership.
        if (!body.bookingIds?.length) return Response.json({ error: 'Select a booking' }, { status: 403 })
        const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id), columns: { stylistId: true } })
        if (!profile?.stylistId) return Response.json({ error: 'Forbidden' }, { status: 403 })
        const owned = await db
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(inArray(bookings.id, body.bookingIds), eq(bookings.stylistId, profile.stylistId), eq(bookings.facilityId, resident.facilityId)))
        if (owned.length !== body.bookingIds.length) return Response.json({ error: 'Forbidden' }, { status: 403 })
      } else {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const rl = await checkRateLimit('paymentCollect', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const key = platformStripeKey()
    const publishableKey = platformPublishableKey()
    if (!key || !publishableKey) return Response.json({ error: 'Card payments are not configured' }, { status: 501 })
    if (key.startsWith('sk_live_') && !paymentsLiveEnabled()) {
      return Response.json({ error: 'Live card payments are disabled' }, { status: 501 })
    }

    const stripe = await getPlatformStripe()
    if (!stripe) return Response.json({ error: 'Card payments are not configured' }, { status: 501 })

    // Need a customer when saving the card for future COF.
    const customerId = body.savePaymentMethod
      ? await ensureStripeCustomer({
          id: resident.id,
          name: resident.name,
          facilityId: resident.facilityId,
          poaEmail: resident.poaEmail,
          stripeCustomerId: resident.stripeCustomerId,
        })
      : resident.stripeCustomerId ?? undefined

    const intent = await stripe.paymentIntents.create({
      amount: body.amountCents,
      currency: 'usd',
      payment_method_types: ['card'],
      ...(customerId ? { customer: customerId } : {}),
      ...(body.savePaymentMethod && customerId ? { setup_future_usage: 'off_session' as const } : {}),
      metadata: {
        residentId: resident.id,
        facilityId: resident.facilityId,
        bookingIds: (body.bookingIds ?? []).join(','),
        invoiceIds: (body.invoiceIds ?? []).join(','),
        collectedBy: user.id,
        recordedVia: 'stylist_collect',
        inApp: '1',
        savePaymentMethod: body.savePaymentMethod ? '1' : '0',
      },
    })

    return Response.json({ data: { clientSecret: intent.client_secret, publishableKey, paymentIntentId: intent.id } })
  } catch (err) {
    console.error('POST /api/payments/intent error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
