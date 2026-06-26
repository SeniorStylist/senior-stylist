import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { portalCoupons, portalCouponRedemptions, portalAccountResidents } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  residentId: z.string().uuid(),
  portalAccountId: z.string().uuid().optional(), // optional: issue to one specific account
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ couponId: string }> }) {
  try {
    const { couponId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const fu = await getUserFacility(user.id)
    if (!fu) return Response.json({ error: 'No facility' }, { status: 400 })
    if (fu.role !== 'admin' && fu.role !== 'super_admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'residentId required' }, { status: 422 })
    const { residentId, portalAccountId } = parsed.data

    // Coupon must belong to this facility and be active.
    const coupon = await db.query.portalCoupons.findFirst({
      where: and(eq(portalCoupons.id, couponId), eq(portalCoupons.facilityId, fu.facilityId)),
    })
    if (!coupon) return Response.json({ error: 'Coupon not found' }, { status: 404 })
    if (!coupon.active) return Response.json({ error: 'Coupon is inactive' }, { status: 409 })
    if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
      return Response.json({ error: 'Coupon has expired' }, { status: 409 })
    }

    // Global redemption cap.
    if (coupon.maxRedemptions != null) {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(portalCouponRedemptions)
        .where(eq(portalCouponRedemptions.couponId, couponId))
      if (Number(n) >= coupon.maxRedemptions) {
        return Response.json({ error: 'Coupon has reached its redemption limit' }, { status: 409 })
      }
    }

    // Resolve the recipient portal account(s) linked to the resident at this facility.
    const links = await db
      .select({ portalAccountId: portalAccountResidents.portalAccountId })
      .from(portalAccountResidents)
      .where(and(eq(portalAccountResidents.residentId, residentId), eq(portalAccountResidents.facilityId, fu.facilityId)))

    let accountIds = links.map((l) => l.portalAccountId)
    if (portalAccountId) accountIds = accountIds.filter((id) => id === portalAccountId)
    if (accountIds.length === 0) {
      return Response.json({ error: 'This resident has no linked family portal account yet' }, { status: 409 })
    }

    const maxPer = coupon.maxPerAccount ?? 1
    const discountCents = coupon.discountType === 'fixed' ? coupon.discountValue : 0
    let issued = 0
    const skipped: string[] = []

    for (const accId of accountIds) {
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(portalCouponRedemptions)
        .where(and(eq(portalCouponRedemptions.couponId, couponId), eq(portalCouponRedemptions.portalAccountId, accId)))
      if (Number(n) >= maxPer) {
        skipped.push(accId)
        continue
      }
      await db.insert(portalCouponRedemptions).values({
        couponId,
        portalAccountId: accId,
        residentId,
        facilityId: fu.facilityId,
        bookingId: null,
        discountCents,
      })
      issued++
    }

    if (issued === 0) {
      return Response.json({ error: 'Already issued to this family (per-account limit reached)' }, { status: 409 })
    }

    return Response.json({ data: { issued, skipped: skipped.length } })
  } catch (err) {
    console.error('POST /api/facility/coupons/[couponId]/issue error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
