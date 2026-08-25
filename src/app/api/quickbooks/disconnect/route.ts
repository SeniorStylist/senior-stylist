import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { ensureQbLinksSchema } from '@/lib/qb-links-ddl'
import { getUserFacility, canManageQuickBooksBilling } from '@/lib/get-facility-id'
import { revokeQBToken } from '@/lib/quickbooks'
import { NextRequest } from 'next/server'

export async function POST(_request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!canManageQuickBooksBilling(facilityUser.role)) {
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
        // Reset sync state too — a stale cursor on reconnect silently skips
        // every invoice changed while disconnected (P48 cursor contract).
        qbInvoicesSyncCursor: null,
        qbInvoicesLastSyncedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(facilities.id, facilityUser.facilityId))

    // Clear per-facility QB sync cursors too (qb_customer_links stays — a
    // reconnect is almost always the same realm and Sync Customers repairs a
    // realm change). Best-effort: the table may predate migration 0043.
    try {
      await ensureQbLinksSchema()
      await db.execute(
        sql`UPDATE qb_sync_state SET payments_sync_cursor = NULL, payments_last_synced_at = NULL, updated_at = now() WHERE facility_id = ${facilityUser.facilityId}`,
      )
    } catch (err) {
      console.error('QB sync-state clear failed (non-fatal):', err)
    }

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
