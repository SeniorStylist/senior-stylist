// Phase 15 safeguards — in-app refund for a Stripe-recorded payment. Before this,
// reversing a mistaken charge required the Stripe dashboard AND left the app's
// ledger wrong. Full-amount refunds only (v1).
//
// Ledger semantics: the qb_payments row's amountCents is zeroed and the original
// amount is preserved in the memo, so collected totals stay correct everywhere.
// Invoice applications are NOT auto-reversed (which invoices this payment paid
// isn't reliably recorded) — the response says so and the operator re-opens
// balances via the normal QB re-import / unapplied-credit workflow if needed.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { qbPayments } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getPlatformStripe } from '@/lib/payments/stripe-client'

export const dynamic = 'force-dynamic'

const schema = z.object({ paymentId: z.string().uuid() })

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const payment = await db.query.qbPayments.findFirst({
      where: eq(qbPayments.id, parsed.data.paymentId),
      columns: { id: true, facilityId: true, amountCents: true, stripePaymentIntentId: true, memo: true },
    })
    if (!payment) return Response.json({ error: 'Payment not found' }, { status: 404 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu || !canAccessBilling(fu.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (fu.role !== 'bookkeeper' && fu.facilityId !== payment.facilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const rl = await checkRateLimit('paymentCollect', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    if (!payment.stripePaymentIntentId) {
      return Response.json({ error: 'Only card payments processed through the app can be refunded here' }, { status: 422 })
    }
    if (payment.amountCents <= 0) {
      return Response.json({ error: 'This payment was already refunded' }, { status: 409 })
    }

    const stripe = await getPlatformStripe()
    if (!stripe) return Response.json({ error: 'Card payments are not configured' }, { status: 501 })

    // Refund at Stripe FIRST (outside any DB transaction — max:1 pool rule),
    // then zero the ledger row. A repeat call 409s above on amountCents === 0.
    await stripe.refunds.create({ payment_intent: payment.stripePaymentIntentId })

    const originalCents = payment.amountCents
    const stamp = `[REFUNDED $${(originalCents / 100).toFixed(2)} on ${new Date().toISOString().slice(0, 10)}]`
    await db
      .update(qbPayments)
      .set({
        amountCents: 0,
        memo: `${payment.memo ? payment.memo + ' ' : ''}${stamp}`.slice(0, 2000),
      })
      .where(eq(qbPayments.id, payment.id))

    revalidateTag('billing', {})

    return Response.json({
      data: {
        refundedCents: originalCents,
        note: 'Refunded at Stripe and zeroed in the ledger. Invoice balances are NOT reopened automatically — adjust via QB or an account credit if this payment had been applied.',
      },
    })
  } catch (err) {
    const e = err as { message?: string }
    console.error('POST /api/payments/refund error:', err)
    return Response.json({ error: e?.message ?? 'Refund failed' }, { status: 500 })
  }
}
