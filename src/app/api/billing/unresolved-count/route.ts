import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { qbUnresolvedPayments } from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    const facilityUser = await getUserFacility(user.id)
    if (!isMaster && (!facilityUser || !canAccessBilling(facilityUser.role))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(request.url)
    const queryFacilityId = url.searchParams.get('facilityId')
    const scopeFacilityId = isMaster
      ? queryFacilityId || null
      : facilityUser?.facilityId ?? null

    if (!isMaster && !scopeFacilityId) {
      return Response.json({ data: { count: 0 } })
    }

    const [row] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(qbUnresolvedPayments)
      .where(
        scopeFacilityId
          ? and(
              isNull(qbUnresolvedPayments.resolvedAt),
              eq(qbUnresolvedPayments.facilityId, scopeFacilityId),
            )
          : isNull(qbUnresolvedPayments.resolvedAt),
      )

    return Response.json({ data: { count: row?.count ?? 0 } })
  } catch (err) {
    console.error('[unresolved-count] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
