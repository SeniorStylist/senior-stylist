import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility, canManageQuickBooksBilling } from '@/lib/get-facility-id'
import { qbGet } from '@/lib/quickbooks'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface QBCompanyInfoResponse {
  CompanyInfo?: { CompanyName?: string }
}

// Connection-health probe. Always returns 200 with { data } — broken states
// are data, not transport failures, so the client can render them inline.
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    let facilityId: string | null = null
    const requested = request.nextUrl.searchParams.get('facilityId')
    if (isMaster && requested) {
      if (!UUID_RE.test(requested)) {
        return Response.json({ error: 'Invalid facilityId' }, { status: 400 })
      }
      facilityId = requested
    } else {
      const facilityUser = await getUserFacility(user.id)
      if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
      if (!canManageQuickBooksBilling(facilityUser.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      facilityId = facilityUser.facilityId
    }

    const rl = await checkRateLimit('qbStatus', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: {
        qbRealmId: true,
        qbAccessToken: true,
        qbRefreshToken: true,
        qbTokenExpiresAt: true,
        qbInvoicesLastSyncedAt: true,
      },
    })
    if (!facility) return Response.json({ error: 'Facility not found' }, { status: 404 })

    if (!facility.qbRealmId || !facility.qbAccessToken || !facility.qbRefreshToken) {
      return Response.json({ data: { connected: false } })
    }

    try {
      const info = await qbGet<QBCompanyInfoResponse>(
        facilityId,
        `/companyinfo/${facility.qbRealmId}?minorversion=65`,
      )
      return Response.json({
        data: {
          connected: true,
          ok: true,
          companyName: info.CompanyInfo?.CompanyName ?? null,
          realmId: facility.qbRealmId,
          tokenExpiresAt: facility.qbTokenExpiresAt?.toISOString() ?? null,
          lastInvoiceSyncAt: facility.qbInvoicesLastSyncedAt?.toISOString() ?? null,
        },
      })
    } catch (err) {
      const message = (err as Error).message ?? ''
      const reconnectNeeded =
        message.includes('token refresh failed') || message.includes('invalid_grant')
      return Response.json({
        data: {
          connected: true,
          ok: false,
          reason: reconnectNeeded ? 'reconnect_needed' : 'error',
          message: message.slice(0, 200),
        },
      })
    }
  } catch (err) {
    console.error('[quickbooks/status] error:', err)
    return Response.json(
      { error: (err as Error).message ?? 'Internal server error' },
      { status: 500 },
    )
  }
}
