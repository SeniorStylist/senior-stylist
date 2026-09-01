import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, quickbooksSyncLog } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility, canManageQuickBooksBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { syncQBCustomers } from '@/lib/qb-customer-sync'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Operator-clicked WRITE to the facility's books — manage tier only, ungated
// by QB_INVOICE_SYNC_ENABLED (same posture as the payroll Bill push: only
// reachable on a facility whose OAuth connection already works).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ facilityId: string }> },
) {
  try {
    const { facilityId } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu || !canManageQuickBooksBilling(fu.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (fu.facilityId !== facilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const rl = await checkRateLimit('qbCustomerSync', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { qbRealmId: true, qbAccessToken: true, qbRefreshToken: true },
    })
    if (!facility?.qbRealmId || !facility.qbAccessToken || !facility.qbRefreshToken) {
      return Response.json({ error: 'QuickBooks not connected' }, { status: 412 })
    }

    const result = await syncQBCustomers(facilityId, { createdBy: user.id })

    db.insert(quickbooksSyncLog)
      .values({
        facilityId,
        action: 'sync_customers',
        status: result.errors.length > 0 ? 'error' : 'success',
        errorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join(' | ').slice(0, 500) : null,
        responseSummary: `${result.matchedExisting} matched, ${result.createdInQb} created, ${result.skipped} skipped`,
      })
      .catch((e) => console.error('[qb-log]', e))

    revalidateTag('billing', {})
    revalidateTag('facilities', {})

    return Response.json({ data: result })
  } catch (err) {
    console.error('[quickbooks/sync-customers] error:', err)
    return Response.json(
      { error: (err as Error).message ?? 'Internal server error' },
      { status: 500 },
    )
  }
}
