// Manually apply an unapplied QB credit to selected open invoices — site-side only
// (QB is not written back; mirror the application inside QuickBooks, then the next
// Step 2 import converges instead of reverting). Master admin only.

import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { qbUnappliedCredits } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { ensureUnappliedSchema } from '@/lib/unapplied-ddl'
import { applyCreditToInvoices, recomputeFacilityBalances, type CreditAllocation } from '@/lib/unapplied-apply'

export const dynamic = 'force-dynamic'

const schema = z.object({
  creditId: z.string().uuid(),
  invoiceIds: z.array(z.string().uuid()).min(1).max(50),
})

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!superAdminEmail || user.email !== superAdminEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    await ensureUnappliedSchema()

    const credit = await db.query.qbUnappliedCredits.findFirst({
      where: eq(qbUnappliedCredits.id, parsed.data.creditId),
    })
    if (!credit) return Response.json({ error: 'Credit not found' }, { status: 404 })
    if (credit.openBalanceCents - credit.appliedCents <= 0) {
      return Response.json({ error: 'Credit is already fully applied' }, { status: 400 })
    }

    let result: { allocations: CreditAllocation[]; appliedCents: number }
    try {
      result = await db.transaction(async (tx) => {
        const r = await applyCreditToInvoices(tx, credit, parsed.data.invoiceIds, user.id)
        await recomputeFacilityBalances(tx, [credit.facilityId])
        return r
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apply failed'
      return Response.json({ error: msg }, { status: 400 })
    }

    revalidateTag('billing', {})
    return Response.json({
      data: {
        appliedCents: result.appliedCents,
        remainingCents: credit.openBalanceCents - credit.appliedCents - result.appliedCents,
        allocations: result.allocations,
      },
    })
  } catch (err) {
    console.error('[unapplied-credits/apply] error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
