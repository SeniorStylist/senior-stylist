import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility, canAccessPayroll } from '@/lib/get-facility-id'
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

    const query = encodeURIComponent(
      "select Id, Name, AccountType, AccountSubType from Account where AccountType = 'Expense' and Active = true",
    )
    const data = await qbGet<QBQueryResponse>(
      facilityUser.facilityId,
      `/query?query=${query}&minorversion=65`,
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
