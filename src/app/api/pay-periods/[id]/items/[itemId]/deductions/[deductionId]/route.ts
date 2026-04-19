import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { payPeriods, stylistPayItems, payDeductions } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { computeNetPay } from '@/lib/payroll'
import { and, eq } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string; deductionId: string }> },
) {
  try {
    const { id, itemId, deductionId } = await params
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

    const deduction = await db.query.payDeductions.findFirst({
      where: eq(payDeductions.id, deductionId),
    })
    if (!deduction || deduction.payItemId !== itemId) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const result = await db.transaction(async (tx) => {
      await tx.delete(payDeductions).where(eq(payDeductions.id, deductionId))

      const deductions = await tx.query.payDeductions.findMany({
        where: eq(payDeductions.payItemId, itemId),
      })

      const netPayCents = computeNetPay(existing, deductions)

      const [item] = await tx
        .update(stylistPayItems)
        .set({ netPayCents, updatedAt: new Date() })
        .where(eq(stylistPayItems.id, itemId))
        .returning()

      return { item }
    })

    revalidateTag('pay-periods', {})

    return Response.json({ data: result })
  } catch (err) {
    console.error('DELETE /api/pay-periods/[id]/items/[itemId]/deductions/[deductionId] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
