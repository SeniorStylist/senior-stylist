import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { payPeriods, stylistPayItems, payDeductions } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { computeNetPay } from '@/lib/payroll'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'

const createSchema = z.object({
  deductionType: z.enum(['cash_kept', 'supplies', 'advance', 'other']),
  amountCents: z.number().int().min(1).max(10_000_000),
  note: z.string().max(500).optional(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const period = await db.query.payPeriods.findFirst({
      where: and(eq(payPeriods.id, id), eq(payPeriods.facilityId, facilityUser.facilityId)),
    })
    if (!period) return Response.json({ error: 'Not found' }, { status: 404 })
    if (period.status === 'paid') {
      return Response.json({ error: 'Period is paid and locked' }, { status: 403 })
    }

    const existing = await db.query.stylistPayItems.findFirst({
      where: eq(stylistPayItems.id, itemId),
    })
    if (!existing || existing.payPeriodId !== id) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const result = await db.transaction(async (tx) => {
      const [deduction] = await tx
        .insert(payDeductions)
        .values({
          payItemId: itemId,
          stylistId: existing.stylistId,
          payPeriodId: id,
          deductionType: parsed.data.deductionType,
          amountCents: parsed.data.amountCents,
          note: parsed.data.note ?? null,
          createdBy: user.id,
        })
        .returning()

      const deductions = await tx.query.payDeductions.findMany({
        where: eq(payDeductions.payItemId, itemId),
      })

      const netPayCents = computeNetPay(existing, deductions)

      const [item] = await tx
        .update(stylistPayItems)
        .set({ netPayCents, updatedAt: new Date() })
        .where(eq(stylistPayItems.id, itemId))
        .returning()

      return { deduction, item }
    })

    revalidateTag('pay-periods', {})

    return Response.json({ data: result })
  } catch (err) {
    console.error('POST /api/pay-periods/[id]/items/[itemId]/deductions error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
