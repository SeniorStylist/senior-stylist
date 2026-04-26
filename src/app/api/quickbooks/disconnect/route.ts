import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility, canAccessPayroll } from '@/lib/get-facility-id'
import { revokeQBToken } from '@/lib/quickbooks'
import { NextRequest } from 'next/server'

export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!canAccessPayroll(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityUser.facilityId),
      columns: { qbRefreshToken: true },
    })

    await db
      .update(facilities)
      .set({
        qbRealmId: null,
        qbAccessToken: null,
        qbRefreshToken: null,
        qbTokenExpiresAt: null,
        qbExpenseAccountId: null,
        updatedAt: new Date(),
      })
      .where(eq(facilities.id, facilityUser.facilityId))

    if (facility?.qbRefreshToken) {
      revokeQBToken(facility.qbRefreshToken).catch((err) =>
        console.error('QB revoke failed (non-fatal):', err),
      )
    }

    return Response.json({ data: { disconnected: true } })
  } catch (err) {
    console.error('QuickBooks disconnect error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
