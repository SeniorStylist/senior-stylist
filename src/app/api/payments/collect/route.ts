// Collect a COF balance now: draw the salon account and/or charge the resident's
// saved card via the shared engine. Billing staff (manual "Collect now"). On
// failure, optionally fires the failover pay-link for the uncollected remainder.
//
// NOTE: this charges a SAVED card (off-session COF). The P3 in-app stylist flow
// (new card via Payment Element, on-session) is a separate route.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { collectForResident, type CollectMethod } from '@/lib/payments/charge'
import { sendPaymentRequest } from '@/lib/payments/pay-link'

export const dynamic = 'force-dynamic'

const schema = z.object({
  residentId: z.string().uuid(),
  amountCents: z.number().int().min(1).max(10_000_000),
  bookingIds: z.array(z.string().uuid()).max(200).optional(),
  invoiceIds: z.array(z.string().uuid()).max(200).optional(),
  method: z.enum(['salon_then_card', 'card', 'salon_account']).optional(),
  paymentMethodId: z.string().max(200).optional(),
  idempotencyKey: z.string().max(200).optional(),
  sendLinkOnFail: z.boolean().default(true),
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
      columns: { id: true, facilityId: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu || !canAccessBilling(fu.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (fu.role !== 'bookkeeper' && fu.facilityId !== resident.facilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const rl = await checkRateLimit('paymentCollect', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const result = await collectForResident({
      residentId: body.residentId,
      amountCents: body.amountCents,
      bookingIds: body.bookingIds,
      invoiceIds: body.invoiceIds,
      method: body.method as CollectMethod | undefined,
      paymentMethodId: body.paymentMethodId,
      collectedBy: user.id,
      recordedVia: 'manual',
      idempotencyKey: body.idempotencyKey,
    })

    // On failure, fire the failover pay-link for whatever couldn't be collected.
    let payLink: Awaited<ReturnType<typeof sendPaymentRequest>> | null = null
    if (!result.ok && body.sendLinkOnFail && result.code !== 'invalid') {
      const uncollected = body.amountCents - result.salonCents
      payLink = await sendPaymentRequest({
        residentId: body.residentId,
        amountCents: uncollected > 0 ? uncollected : undefined,
        reason: result.reason,
      })
    }

    return Response.json({ data: { result, payLink } })
  } catch (err) {
    console.error('POST /api/payments/collect error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
