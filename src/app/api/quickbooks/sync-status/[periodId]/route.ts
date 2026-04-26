import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, payPeriods, stylistPayItems } from '@/db/schema'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getUserFacility, canAccessPayroll } from '@/lib/get-facility-id'
import { qbGet } from '@/lib/quickbooks'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface QBBill {
  Id: string
  Balance?: number
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ periodId: string }> },
) {
  try {
    const { periodId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!canAccessPayroll(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('quickbooksSync', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityUser.facilityId),
      columns: { qbAccessToken: true, qbRealmId: true },
    })
    if (!facility?.qbAccessToken || !facility?.qbRealmId) {
      return Response.json({ error: 'QuickBooks not connected' }, { status: 412 })
    }

    const period = await db.query.payPeriods.findFirst({
      where: and(
        eq(payPeriods.id, periodId),
        eq(payPeriods.facilityId, facilityUser.facilityId),
      ),
    })
    if (!period) return Response.json({ error: 'Period not found' }, { status: 404 })

    const items = await db
      .select({
        id: stylistPayItems.id,
        qbBillId: stylistPayItems.qbBillId,
      })
      .from(stylistPayItems)
      .where(
        and(
          eq(stylistPayItems.payPeriodId, periodId),
          isNotNull(stylistPayItems.qbBillId),
        ),
      )

    const results: Array<{ payItemId: string; qbBillId: string; qbBalance: number }> = []
    let allPaid = items.length > 0

    for (const item of items) {
      if (!item.qbBillId) continue
      try {
        const res = await qbGet<{ Bill: QBBill }>(
          facilityUser.facilityId,
          `/bill/${item.qbBillId}`,
        )
        const balance = typeof res.Bill.Balance === 'number' ? res.Bill.Balance : 0
        results.push({ payItemId: item.id, qbBillId: item.qbBillId, qbBalance: balance })
        if (balance > 0) allPaid = false
      } catch (err) {
        console.error('QB sync-status item error:', err)
        allPaid = false
      }
    }

    let periodUpdated = false
    let periodStatus = period.status
    if (allPaid && period.status !== 'paid') {
      await db
        .update(payPeriods)
        .set({ status: 'paid', updatedAt: new Date() })
        .where(eq(payPeriods.id, periodId))
      periodStatus = 'paid'
      periodUpdated = true
      revalidateTag('pay-periods', {})
    }

    return Response.json({
      data: { items: results, periodStatus, periodUpdated },
    })
  } catch (err) {
    console.error('QuickBooks sync-status error:', err)
    return Response.json(
      { error: (err as Error).message ?? 'Internal server error' },
      { status: 500 },
    )
  }
}
