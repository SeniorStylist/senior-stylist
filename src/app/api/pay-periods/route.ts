import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  payPeriods,
  stylistPayItems,
  stylists,
  stylistFacilityAssignments,
  bookings,
  franchiseFacilities,
} from '@/db/schema'
import { getUserFacility, canAccessPayroll } from '@/lib/get-facility-id'
import { resolveCommission } from '@/lib/stylist-commission'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { and, eq, desc, gte, lt, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')

const createSchema = z
  .object({
    periodType: z.enum(['weekly', 'biweekly', 'monthly']),
    startDate: isoDate,
    endDate: isoDate,
    notes: z.string().max(2000).optional(),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  })

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!canAccessPayroll(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const periods = await db.query.payPeriods.findMany({
      where: eq(payPeriods.facilityId, facilityUser.facilityId),
      orderBy: [desc(payPeriods.startDate)],
      with: { items: { columns: { id: true, stylistId: true, netPayCents: true } } },
    })

    const data = periods.map((p) => ({
      id: p.id,
      facilityId: p.facilityId,
      franchiseId: p.franchiseId,
      periodType: p.periodType,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      notes: p.notes,
      createdBy: p.createdBy,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      stylistCount: p.items.length,
      totalPayoutCents: p.items.reduce((s, it) => s + it.netPayCents, 0),
    }))

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/pay-periods error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!canAccessPayroll(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('payPeriodCreate', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { facilityId } = facilityUser
    const { periodType, startDate, endDate, notes } = parsed.data

    const franchiseRow = await db.query.franchiseFacilities.findFirst({
      where: eq(franchiseFacilities.facilityId, facilityId),
    })
    const franchiseId = franchiseRow?.franchiseId ?? null

    const endExclusive = new Date(`${endDate}T00:00:00Z`)
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
    const startInclusive = new Date(`${startDate}T00:00:00Z`)

    const result = await db.transaction(async (tx) => {
      const [period] = await tx
        .insert(payPeriods)
        .values({
          facilityId,
          franchiseId,
          periodType,
          startDate,
          endDate,
          status: 'open',
          notes: notes ?? null,
          createdBy: user.id,
        })
        .returning()

      const assignments = await tx
        .select({
          stylistId: stylistFacilityAssignments.stylistId,
          overrideCommission: stylistFacilityAssignments.commissionPercent,
          defaultCommission: stylists.commissionPercent,
        })
        .from(stylistFacilityAssignments)
        .innerJoin(stylists, eq(stylists.id, stylistFacilityAssignments.stylistId))
        .where(
          and(
            eq(stylistFacilityAssignments.facilityId, facilityId),
            eq(stylistFacilityAssignments.active, true),
            eq(stylists.active, true),
            eq(stylists.status, 'active'),
          ),
        )

      if (assignments.length === 0) {
        return { period, itemCount: 0 }
      }

      const stylistIds = assignments.map((a) => a.stylistId)

      const completed = await tx
        .select({
          stylistId: bookings.stylistId,
          priceCents: bookings.priceCents,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.facilityId, facilityId),
            eq(bookings.status, 'completed'),
            inArray(bookings.stylistId, stylistIds),
            gte(bookings.startTime, startInclusive),
            lt(bookings.startTime, endExclusive),
          ),
        )

      const grossByStylist = new Map<string, number>()
      for (const b of completed) {
        grossByStylist.set(
          b.stylistId,
          (grossByStylist.get(b.stylistId) ?? 0) + (b.priceCents ?? 0),
        )
      }

      const values = assignments.map((a) => {
        const gross = grossByStylist.get(a.stylistId) ?? 0
        const rate = resolveCommission(a.defaultCommission, { commissionPercent: a.overrideCommission })
        const commissionAmount = Math.round((gross * rate) / 100)
        return {
          payPeriodId: period.id,
          stylistId: a.stylistId,
          facilityId,
          payType: 'commission',
          grossRevenueCents: gross,
          commissionRate: rate,
          commissionAmountCents: commissionAmount,
          netPayCents: commissionAmount,
        }
      })

      await tx.insert(stylistPayItems).values(values)

      return { period, itemCount: values.length }
    })

    revalidateTag('pay-periods', {})

    return Response.json({
      data: {
        period: result.period,
        itemCount: result.itemCount,
      },
    })
  } catch (err) {
    console.error('POST /api/pay-periods error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
