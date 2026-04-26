import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, payPeriods, stylistPayItems, stylists } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { getUserFacility, canAccessPayroll } from '@/lib/get-facility-id'
import { qbGet, qbPost } from '@/lib/quickbooks'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { syncVendorsForFacility } from '../../sync-vendors/route'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface QBBill {
  Id: string
  SyncToken: string
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
      columns: {
        qbAccessToken: true,
        qbRealmId: true,
        qbExpenseAccountId: true,
      },
    })
    if (!facility?.qbAccessToken || !facility?.qbRealmId) {
      return Response.json({ error: 'QuickBooks not connected' }, { status: 412 })
    }
    if (!facility.qbExpenseAccountId) {
      return Response.json(
        { error: 'Select a QuickBooks expense account in Settings first' },
        { status: 412 },
      )
    }

    const period = await db.query.payPeriods.findFirst({
      where: and(
        eq(payPeriods.id, periodId),
        eq(payPeriods.facilityId, facilityUser.facilityId),
      ),
    })
    if (!period) return Response.json({ error: 'Period not found' }, { status: 404 })
    if (period.status === 'open') {
      return Response.json(
        { error: 'Advance period to processing before pushing to QuickBooks' },
        { status: 412 },
      )
    }

    const items = await db
      .select({
        id: stylistPayItems.id,
        stylistId: stylistPayItems.stylistId,
        netPayCents: stylistPayItems.netPayCents,
        qbBillId: stylistPayItems.qbBillId,
        periodType: payPeriods.periodType,
        stylistName: stylists.name,
        stylistQbVendorId: stylists.qbVendorId,
      })
      .from(stylistPayItems)
      .innerJoin(payPeriods, eq(payPeriods.id, stylistPayItems.payPeriodId))
      .innerJoin(stylists, eq(stylists.id, stylistPayItems.stylistId))
      .where(eq(stylistPayItems.payPeriodId, periodId))

    // Auto-sync any stylists missing a vendor mapping.
    const missingVendorStylistIds = items
      .filter((it) => !it.stylistQbVendorId && it.netPayCents > 0)
      .map((it) => it.stylistId)
    if (missingVendorStylistIds.length > 0) {
      await syncVendorsForFacility(facilityUser.facilityId, missingVendorStylistIds)
    }

    // Reload stylist vendor IDs for any that we just auto-synced.
    const vendorMap = new Map<string, string | null>()
    if (missingVendorStylistIds.length > 0) {
      const updated = await db
        .select({ id: stylists.id, qbVendorId: stylists.qbVendorId })
        .from(stylists)
        .where(inArray(stylists.id, missingVendorStylistIds))
      for (const s of updated) vendorMap.set(s.id, s.qbVendorId)
    }

    let synced = 0
    let failed = 0
    const errors: Array<{ payItemId: string; stylistName: string; message: string }> = []

    const txnDate = period.endDate
    const note = `Senior Stylist payroll ${period.startDate} – ${period.endDate}`

    for (const item of items) {
      if (item.netPayCents <= 0) continue
      const vendorId = item.stylistQbVendorId ?? vendorMap.get(item.stylistId) ?? null
      if (!vendorId) {
        failed += 1
        const msg = 'Missing QuickBooks vendor mapping'
        errors.push({ payItemId: item.id, stylistName: item.stylistName, message: msg })
        await db
          .update(stylistPayItems)
          .set({ qbSyncError: msg, updatedAt: new Date() })
          .where(eq(stylistPayItems.id, item.id))
        continue
      }

      const payload = {
        VendorRef: { value: vendorId },
        TxnDate: txnDate,
        DueDate: txnDate,
        PrivateNote: note,
        Line: [
          {
            Amount: item.netPayCents / 100,
            DetailType: 'AccountBasedExpenseLineDetail',
            AccountBasedExpenseLineDetail: {
              AccountRef: { value: facility.qbExpenseAccountId },
            },
            Description: `${item.stylistName} — ${item.periodType} commission`,
          },
        ],
      }

      try {
        if (item.qbBillId) {
          const existing = await qbGet<{ Bill: QBBill }>(
            facilityUser.facilityId,
            `/bill/${item.qbBillId}`,
          )
          const updateRes = await qbPost<{ Bill: QBBill }>(
            facilityUser.facilityId,
            '/bill',
            { ...payload, Id: item.qbBillId, SyncToken: existing.Bill.SyncToken, sparse: true },
          )
          await db
            .update(stylistPayItems)
            .set({
              qbBillSyncToken: updateRes.Bill.SyncToken,
              qbSyncError: null,
              updatedAt: new Date(),
            })
            .where(eq(stylistPayItems.id, item.id))
        } else {
          const res = await qbPost<{ Bill: QBBill }>(
            facilityUser.facilityId,
            '/bill',
            payload,
          )
          await db
            .update(stylistPayItems)
            .set({
              qbBillId: res.Bill.Id,
              qbBillSyncToken: res.Bill.SyncToken,
              qbSyncError: null,
              updatedAt: new Date(),
            })
            .where(eq(stylistPayItems.id, item.id))
        }
        synced += 1
      } catch (err) {
        failed += 1
        const message = (err as Error).message?.slice(0, 200) ?? 'Unknown error'
        errors.push({ payItemId: item.id, stylistName: item.stylistName, message })
        await db
          .update(stylistPayItems)
          .set({ qbSyncError: message, updatedAt: new Date() })
          .where(eq(stylistPayItems.id, item.id))
      }
    }

    await db
      .update(payPeriods)
      .set({
        qbSyncedAt: synced > 0 ? new Date() : period.qbSyncedAt,
        qbSyncError: failed > 0 ? `${failed} item(s) failed` : null,
        updatedAt: new Date(),
      })
      .where(eq(payPeriods.id, periodId))

    revalidateTag('pay-periods', {})

    return Response.json({ data: { synced, failed, errors } })
  } catch (err) {
    console.error('QuickBooks sync-bill error:', err)
    return Response.json(
      { error: (err as Error).message ?? 'Internal server error' },
      { status: 500 },
    )
  }
}
