import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { residents, qbUnappliedCredits } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { ensureUnappliedSchema } from '@/lib/unapplied-ddl'
import { applyCreditToInvoices, recomputeFacilityBalances } from '@/lib/unapplied-apply'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1).max(50),
})

// Manually attribute an account credit (prepayment / gift / coupon) to chosen
// open invoices. The operator picks where the money goes — no auto-apply.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ residentId: string; creditId: string }> },
) {
  try {
    const { residentId, creditId } = await params

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, residentId),
      columns: { id: true, facilityId: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu || !canAccessBilling(fu.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (fu.role !== 'bookkeeper' && fu.facilityId !== resident.facilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'invoiceIds required' }, { status: 422 })

    await ensureUnappliedSchema()

    const credit = await db.query.qbUnappliedCredits.findFirst({
      where: and(
        eq(qbUnappliedCredits.id, creditId),
        eq(qbUnappliedCredits.residentId, residentId),
        eq(qbUnappliedCredits.facilityId, resident.facilityId),
      ),
    })
    if (!credit) return Response.json({ error: 'Credit not found' }, { status: 404 })

    let appliedCents = 0
    try {
      await db.transaction(async (tx) => {
        const result = await applyCreditToInvoices(
          tx,
          {
            id: credit.id,
            facilityId: credit.facilityId,
            openBalanceCents: credit.openBalanceCents,
            appliedCents: credit.appliedCents,
            appliedDetail: credit.appliedDetail ?? null,
          },
          parsed.data.invoiceIds,
          user.id,
        )
        appliedCents = result.appliedCents
        await recomputeFacilityBalances(tx, [credit.facilityId])
      })
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : 'Apply failed' }, { status: 422 })
    }

    revalidateTag('billing', {})
    revalidateTag('bookings', {})

    return Response.json({ data: { appliedCents } })
  } catch (err) {
    console.error('POST /api/residents/[residentId]/credits/[creditId]/apply error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
