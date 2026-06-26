import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { portalCoupons } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'

export const dynamic = 'force-dynamic'

const patchSchema = z
  .object({
    discountType: z.enum(['percent', 'fixed']).optional(),
    discountValue: z.number().int().min(1).max(10_000_000).optional(),
    description: z.string().max(500).nullable().optional(),
    maxRedemptions: z.number().int().min(1).max(100_000).nullable().optional(),
    maxPerAccount: z.number().int().min(1).max(1000).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (d) => d.discountType !== 'percent' || d.discountValue === undefined || (d.discountValue >= 1 && d.discountValue <= 100),
    { message: 'Percentage must be between 1 and 100', path: ['discountValue'] },
  )

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ couponId: string }> }) {
  try {
    const { couponId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const fu = await getUserFacility(user.id)
    if (!fu) return Response.json({ error: 'No facility' }, { status: 400 })
    if (fu.role !== 'admin' && fu.role !== 'super_admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    // Scope: coupon must belong to the admin's facility.
    const existing = await db.query.portalCoupons.findFirst({
      where: and(eq(portalCoupons.id, couponId), eq(portalCoupons.facilityId, fu.facilityId)),
      columns: { id: true },
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    const d = parsed.data

    const updates: Record<string, unknown> = {}
    if (d.discountType !== undefined) updates.discountType = d.discountType
    if (d.discountValue !== undefined) updates.discountValue = d.discountValue
    if (d.description !== undefined) updates.description = d.description
    if (d.maxRedemptions !== undefined) updates.maxRedemptions = d.maxRedemptions
    if (d.maxPerAccount !== undefined) updates.maxPerAccount = d.maxPerAccount
    if (d.expiresAt !== undefined) updates.expiresAt = d.expiresAt ? new Date(d.expiresAt) : null
    if (d.active !== undefined) updates.active = d.active

    if (Object.keys(updates).length === 0) return Response.json({ data: { ok: true } })

    const [updated] = await db
      .update(portalCoupons)
      .set(updates)
      .where(and(eq(portalCoupons.id, couponId), eq(portalCoupons.facilityId, fu.facilityId)))
      .returning()

    return Response.json({ data: updated })
  } catch (err) {
    console.error('PATCH /api/facility/coupons/[couponId] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
