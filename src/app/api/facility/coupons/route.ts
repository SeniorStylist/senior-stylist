import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { portalCoupons, portalCouponRedemptions } from '@/db/schema'
import { eq, desc, sql, inArray } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'

export const dynamic = 'force-dynamic'

const createSchema = z
  .object({
    code: z.string().trim().min(2).max(40).optional(),
    type: z.enum(['welcome', 'birthday', 'referral', 'loyalty', 'manual']).default('manual'),
    discountType: z.enum(['percent', 'fixed']),
    discountValue: z.number().int().min(1).max(10_000_000), // percent 1–100 OR cents
    description: z.string().max(500).nullable().optional(),
    maxRedemptions: z.number().int().min(1).max(100_000).nullable().optional(),
    maxPerAccount: z.number().int().min(1).max(1000).default(1),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine((d) => d.discountType !== 'percent' || (d.discountValue >= 1 && d.discountValue <= 100), {
    message: 'Percentage must be between 1 and 100',
    path: ['discountValue'],
  })

async function requireAdmin(userId: string) {
  const fu = await getUserFacility(userId)
  if (!fu) return { error: 'No facility' as const, status: 400 as const }
  if (fu.role !== 'admin' && fu.role !== 'super_admin') return { error: 'Forbidden' as const, status: 403 as const }
  return { facilityId: fu.facilityId }
}

function genCode(): string {
  return `SAVE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const guard = await requireAdmin(user.id)
    if ('error' in guard) return Response.json({ error: guard.error }, { status: guard.status })

    const coupons = await db.query.portalCoupons.findMany({
      where: eq(portalCoupons.facilityId, guard.facilityId),
      orderBy: [desc(portalCoupons.createdAt)],
    })

    // Redemption counts per coupon (one grouped query).
    const ids = coupons.map((c) => c.id)
    const counts = new Map<string, number>()
    if (ids.length) {
      const rows = await db
        .select({ couponId: portalCouponRedemptions.couponId, n: sql<number>`count(*)::int` })
        .from(portalCouponRedemptions)
        .where(inArray(portalCouponRedemptions.couponId, ids))
        .groupBy(portalCouponRedemptions.couponId)
      for (const r of rows) counts.set(r.couponId, Number(r.n))
    }

    return Response.json({
      data: coupons.map((c) => ({ ...c, redemptionCount: counts.get(c.id) ?? 0 })),
    })
  } catch (err) {
    console.error('GET /api/facility/coupons error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const guard = await requireAdmin(user.id)
    if ('error' in guard) return Response.json({ error: guard.error }, { status: guard.status })

    const parsed = createSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    const d = parsed.data

    // Code is globally unique — use the provided one or generate, retrying on collision.
    let code = (d.code || genCode()).toUpperCase()
    let created
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        ;[created] = await db
          .insert(portalCoupons)
          .values({
            facilityId: guard.facilityId,
            code,
            type: d.type,
            discountType: d.discountType,
            discountValue: d.discountValue,
            description: d.description ?? null,
            maxRedemptions: d.maxRedemptions ?? null,
            maxPerAccount: d.maxPerAccount,
            expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
            active: true,
            createdBy: user.id,
          })
          .returning()
        break
      } catch (e) {
        // Unique-violation on code: if the admin supplied it, surface a clear error.
        if (d.code) return Response.json({ error: 'That coupon code is already in use' }, { status: 409 })
        code = genCode()
        if (attempt === 4) throw e
      }
    }

    return Response.json({ data: created })
  } catch (err) {
    console.error('POST /api/facility/coupons error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
