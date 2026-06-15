import { db } from '@/db'
import {
  facilities,
  portalCouponRedemptions,
  portalCoupons,
  residents,
} from '@/db/schema'
import { and, eq } from 'drizzle-orm'

export type CouponInfo = {
  id: string
  code: string
  type: string
  discountType: string
  discountValue: number
  description: string | null
  expiresAt: Date | null
  redemptionId: string
  bookingId: string | null
}

/**
 * Issue a welcome coupon to a portal account for a facility.
 * Idempotent — returns null if already issued or if facility has welcome coupons disabled.
 */
export async function issueWelcomeCoupon(
  facilityId: string,
  portalAccountId: string,
  residentId: string | null,
): Promise<CouponInfo | null> {
  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: {
      portalCouponsEnabled: true,
      portalWelcomeCouponEnabled: true,
      portalWelcomeCouponType: true,
      portalWelcomeCouponValue: true,
    },
  })

  if (!facility?.portalCouponsEnabled || !facility?.portalWelcomeCouponEnabled) return null
  const value = facility.portalWelcomeCouponValue
  if (!value || value <= 0) return null
  const discountType = facility.portalWelcomeCouponType ?? 'fixed'

  // Find or create a welcome coupon template for this facility
  let coupon = await db.query.portalCoupons.findFirst({
    where: and(
      eq(portalCoupons.facilityId, facilityId),
      eq(portalCoupons.type, 'welcome'),
      eq(portalCoupons.active, true),
    ),
  })

  if (!coupon) {
    // Generate a stable code from facilityId
    const shortId = facilityId.replace(/-/g, '').slice(0, 8).toUpperCase()
    const [created] = await db
      .insert(portalCoupons)
      .values({
        facilityId,
        code: `WELCOME-${shortId}`,
        type: 'welcome',
        discountType,
        discountValue: value,
        description: 'Welcome discount for new Family Portal members',
        maxPerAccount: 1,
        active: true,
      })
      .returning()
    coupon = created
  }

  // Idempotency: check if already issued to this account
  const existing = await db.query.portalCouponRedemptions.findFirst({
    where: and(
      eq(portalCouponRedemptions.couponId, coupon.id),
      eq(portalCouponRedemptions.portalAccountId, portalAccountId),
    ),
  })
  if (existing) return null

  // Compute initial discount_cents (0 for percent = pending; actual cents for fixed)
  const discountCents = discountType === 'fixed' ? value : 0

  const [redemption] = await db
    .insert(portalCouponRedemptions)
    .values({
      couponId: coupon.id,
      portalAccountId,
      residentId: residentId ?? null,
      facilityId,
      bookingId: null,
      discountCents,
    })
    .returning()

  return {
    id: coupon.id,
    code: coupon.code,
    type: coupon.type,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    description: coupon.description,
    expiresAt: coupon.expiresAt,
    redemptionId: redemption.id,
    bookingId: null,
  }
}

/**
 * Get all active (unredeemed) coupons for a portal account at a facility.
 */
export async function getPortalCoupons(
  facilityId: string,
  portalAccountId: string,
): Promise<CouponInfo[]> {
  const redemptions = await db.query.portalCouponRedemptions.findMany({
    where: and(
      eq(portalCouponRedemptions.facilityId, facilityId),
      eq(portalCouponRedemptions.portalAccountId, portalAccountId),
    ),
    with: { coupon: true },
    orderBy: (t, { desc }) => [desc(t.redeemedAt)],
  })

  return redemptions
    .filter((r) => r.coupon?.active)
    .map((r) => ({
      id: r.coupon!.id,
      code: r.coupon!.code,
      type: r.coupon!.type,
      discountType: r.coupon!.discountType,
      discountValue: r.coupon!.discountValue,
      description: r.coupon!.description,
      expiresAt: r.coupon!.expiresAt,
      redemptionId: r.id,
      bookingId: r.bookingId,
    }))
}

/** Format a coupon's discount for display (e.g. "$10 off" or "15% off"). */
export function formatCouponDiscount(discountType: string, discountValue: number): string {
  if (discountType === 'fixed') {
    return `$${(discountValue / 100).toFixed(2)} off`
  }
  return `${discountValue}% off`
}
