import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { payPeriods, stylistPayItems, payDeductions } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { computeNetPay } from '@/lib/payroll'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'

const updateSchema = z
  .object({
    payType: z.enum(['commission', 'hourly', 'flat']).optional(),
    hoursWorked: z.number().min(0).max(9999).optional(),
    hourlyRateCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
    flatAmountCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' })

export async function PUT(
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
    const parsed = updateSchema.safeParse(body)
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

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(stylistPayItems)
        .set({
          ...(parsed.data.payType !== undefined ? { payType: parsed.data.payType } : {}),
          ...(parsed.data.hoursWorked !== undefined
            ? { hoursWorked: String(parsed.data.hoursWorked) }
            : {}),
          ...(parsed.data.hourlyRateCents !== undefined
            ? { hourlyRateCents: parsed.data.hourlyRateCents }
            : {}),
          ...(parsed.data.flatAmountCents !== undefined
            ? { flatAmountCents: parsed.data.flatAmountCents }
            : {}),
          ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
          updatedAt: new Date(),
        })
        .where(eq(stylistPayItems.id, itemId))
        .returning()

      const deductions = await tx.query.payDeductions.findMany({
        where: eq(payDeductions.payItemId, itemId),
      })

      const netPayCents = computeNetPay(row, deductions)

      const [finalRow] = await tx
        .update(stylistPayItems)
        .set({ netPayCents, updatedAt: new Date() })
        .where(eq(stylistPayItems.id, itemId))
        .returning()

      return { item: finalRow, deductions }
    })

    revalidateTag('pay-periods', {})

    return Response.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/pay-periods/[id]/items/[itemId] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
