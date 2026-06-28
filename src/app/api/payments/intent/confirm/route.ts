// Finalize an in-app card collection right after the client confirms the Payment
// Element (instant UI). Idempotent — the payment_intent.succeeded webhook is a
// backstop calling the same finalizer.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { finalizeInAppPayment } from '@/lib/payments/finalize'

export const dynamic = 'force-dynamic'

const schema = z.object({ paymentIntentId: z.string().min(1).max(200) })

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const result = await finalizeInAppPayment(parsed.data.paymentIntentId)
    return Response.json({ data: result })
  } catch (err) {
    console.error('POST /api/payments/intent/confirm error:', err)
    return Response.json({ error: 'Could not finalize payment' }, { status: 500 })
  }
}
