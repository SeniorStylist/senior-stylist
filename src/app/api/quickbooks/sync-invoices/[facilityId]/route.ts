import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { syncQBInvoices } from '@/lib/qb-invoice-sync'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ facilityId: string }> },
) {
  try {
    if (process.env.QB_INVOICE_SYNC_ENABLED !== 'true') {
      return Response.json(
        { error: 'Invoice sync not yet available — awaiting Intuit production approval' },
        { status: 503 },
      )
    }

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
      if (!fu || !canAccessBilling(fu.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (fu.facilityId !== facilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const rl = await checkRateLimit('qbInvoiceSync', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { qbRealmId: true, qbAccessToken: true, qbRefreshToken: true },
    })
    if (!facility?.qbRealmId || !facility.qbAccessToken || !facility.qbRefreshToken) {
      return Response.json({ error: 'QuickBooks not connected' }, { status: 412 })
    }

    const body = await req.json().catch(() => ({}))
    const fullSync = body?.fullSync === true

    const result = await syncQBInvoices(facilityId, { fullSync })

    revalidateTag('billing', {})
    revalidateTag('facilities', {})

    return Response.json({ data: result })
  } catch (err) {
    console.error('[quickbooks/sync-invoices] error:', err)
    return Response.json(
      { error: (err as Error).message ?? 'Internal server error' },
      { status: 500 },
    )
  }
}
