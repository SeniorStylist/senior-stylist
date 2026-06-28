// Manually send the failover pay-link to a resident's payor. Billing staff only.
// Also invoked automatically by the auto-collect failure paths (which call
// sendPaymentRequest directly, not this route).

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { sendPaymentRequest } from '@/lib/payments/pay-link'

export const dynamic = 'force-dynamic'

const schema = z.object({
  residentId: z.string().uuid(),
  amountCents: z.number().int().min(1).max(10_000_000).optional(),
  reason: z.string().max(200).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, parsed.data.residentId),
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

    const rl = await checkRateLimit('billingSend', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const result = await sendPaymentRequest({
      residentId: parsed.data.residentId,
      amountCents: parsed.data.amountCents,
      reason: parsed.data.reason ?? null,
    })

    return Response.json({ data: result })
  } catch (err) {
    console.error('POST /api/payments/request-payment error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
