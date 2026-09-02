import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canManageQuickBooksBilling } from '@/lib/get-facility-id'
import { isFacilityConnected } from '@/lib/qb-connection'
import { qbGet } from '@/lib/quickbooks'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface QBAccount {
  Id: string
  Name: string
  AccountType: string
  AccountSubType?: string
  Active?: boolean
}

interface QBQueryResponse {
  QueryResponse: { Account?: QBAccount[] }
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!canManageQuickBooksBilling(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('quickbooksSync', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    if (!(await isFacilityConnected(facilityUser.facilityId))) {
      return Response.json({ error: 'QuickBooks not connected' }, { status: 412 })
    }

    const query = encodeURIComponent(
      "select Id, Name, AccountType, AccountSubType from Account where AccountType = 'Expense' and Active = true",
    )
    const data = await qbGet<QBQueryResponse>(
      facilityUser.facilityId,
      `/query?query=${query}&minorversion=75`,
    )
    const accounts = (data.QueryResponse.Account ?? [])
      .map((a) => ({
        id: a.Id,
        name: a.Name,
        accountType: a.AccountType,
        accountSubType: a.AccountSubType ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return Response.json({ data: { accounts } })
  } catch (err) {
    console.error('QuickBooks accounts error:', err)
    return Response.json(
      { error: (err as Error).message ?? 'Internal server error' },
      { status: 500 },
    )
  }
}
