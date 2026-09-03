// P48 — QuickBooks status across the whole network, in one place.
//
// Before this, QB connection state was only visible one facility at a time in
// that facility's Settings → Billing, so "is QuickBooks actually working
// everywhere?" was unanswerable without clicking through every community.
//
// Deliberately a SEPARATE page rather than a /master-admin tab: that page
// already fires 8 queries and P22 exists precisely because its cold burst
// timed out through the max:1 pool. Adding four more aggregations to the same
// render would re-open that outage.
//
// Realm-level connections (2026-09-02): "connected" = attached to a realm whose
// qb_connections row is live. The company-connection card at the top lets the
// master connect ONCE for every facility, attach stragglers, or disconnect the
// whole company.

import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { ensureQbConnectionsSchema, listConnections, type QbConnectionInfo } from '@/lib/qb-connection'
import { QbStatusClient, type QbFacilityRow } from './qb-status-client'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>
const s = (v: unknown): string | null => (typeof v === 'string' ? v : v == null ? null : String(v))
const n = (v: unknown): number => (v == null ? 0 : Number(v))
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null)

/**
 * Four batched queries, Map-joined in JS — never a per-facility loop (P13).
 *
 * P27: NO try/catch inside this callback — unstable_cache would persist a
 * caught-and-returned [] for the whole revalidate window. The call site
 * catches. P26: every Date is serialized to a string IN HERE, because cached
 * values are JSON round-tripped and come back as strings.
 *
 * Security: `connected` is derived in SQL from qb_connections. No token column
 * is ever selected, so none can reach the client payload (the sanitize.ts rule).
 */
const getCachedQbStatus = unstable_cache(
  async (): Promise<QbFacilityRow[]> => {
    const [facRows, logRows, importRows, balanceRows] = await Promise.all([
      db.execute(sql`
        SELECT f.id::text AS id, f.name, f.facility_code,
               f.qb_realm_id,
               EXISTS (
                 SELECT 1 FROM qb_connections c
                 WHERE c.realm_id = f.qb_realm_id AND c.refresh_token IS NOT NULL AND c.revoked_at IS NULL
               ) AS connected,
               (f.qb_expense_account_id IS NOT NULL) AS has_expense_account,
               f.qb_invoices_last_synced_at
        FROM facilities f
        WHERE f.active = true AND f.is_demo = false
        ORDER BY f.name
      `),
      db.execute(sql`
        SELECT DISTINCT ON (facility_id)
               facility_id::text AS facility_id, action, status, error_message, created_at
        FROM quickbooks_sync_log
        ORDER BY facility_id, created_at DESC
      `),
      db.execute(sql`
        SELECT DISTINCT ON (facility_id)
               facility_id::text AS facility_id, source_type, file_name, created_at
        FROM import_batches
        WHERE deleted_at IS NULL AND source_type LIKE 'qb_%'
        ORDER BY facility_id, created_at DESC
      `),
      // Live SUM — facilities.qb_outstanding_balance_cents is denormalized and
      // goes stale between syncs (the P40 rule).
      db.execute(sql`
        SELECT facility_id::text AS facility_id, COALESCE(SUM(open_balance_cents), 0)::bigint AS owed
        FROM qb_invoices
        WHERE is_demo = false AND open_balance_cents > 0
        GROUP BY facility_id
      `),
    ])

    const logs = new Map((logRows as unknown as Row[]).map((r) => [s(r.facility_id)!, r]))
    const imports = new Map((importRows as unknown as Row[]).map((r) => [s(r.facility_id)!, r]))
    const owed = new Map((balanceRows as unknown as Row[]).map((r) => [s(r.facility_id)!, n(r.owed)]))

    return (facRows as unknown as Row[]).map((f) => {
      const id = s(f.id)!
      const log = logs.get(id)
      const imp = imports.get(id)
      return {
        id,
        name: s(f.name) ?? 'Unknown',
        facilityCode: s(f.facility_code),
        connected: f.connected === true,
        realmId: s(f.qb_realm_id),
        hasExpenseAccount: f.has_expense_account === true,
        tokenExpiresAt: null,
        lastInvoiceSyncAt: iso(f.qb_invoices_last_synced_at),
        lastSyncAction: log ? s(log.action) : null,
        lastSyncStatus: log ? s(log.status) : null,
        lastSyncError: log ? s(log.error_message) : null,
        lastSyncAt: log ? iso(log.created_at) : null,
        lastImportType: imp ? s(imp.source_type) : null,
        lastImportFile: imp ? s(imp.file_name) : null,
        lastImportAt: imp ? iso(imp.created_at) : null,
        openBalanceCents: owed.get(id) ?? 0,
      }
    })
  },
  ['master-admin-qb-status'],
  { revalidate: 300, tags: ['facilities', 'billing'] },
)

export default async function QuickBooksStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ facility?: string; qb?: string; attached?: string; skipped?: string; reason?: string }>
}) {
  const user = await getAuthUser()
  if (!user) redirect('/login')
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) redirect('/dashboard')

  const sp = await searchParams

  // Connections are read live (not cached) — the OAuth callback lands here
  // and must show the new state immediately.
  let connections: QbConnectionInfo[] = []
  try {
    await ensureQbConnectionsSchema()
    connections = await listConnections()
  } catch (err) {
    console.error('[master-admin/quickbooks] listConnections failed:', err)
  }

  const rows = await getCachedQbStatus().catch((err) => {
    console.error('[master-admin/quickbooks] getCachedQbStatus failed:', err)
    return [] as QbFacilityRow[]
  })

  return (
    <QbStatusClient
      rows={rows}
      connections={connections}
      facilityFilter={sp.facility ?? null}
      invoiceSyncEnabled={process.env.QB_INVOICE_SYNC_ENABLED === 'true'}
      callbackNotice={
        sp.qb === 'connected'
          ? { kind: 'ok', attached: Number(sp.attached ?? 0), skipped: Number(sp.skipped ?? 0) }
          : sp.qb === 'error'
            ? { kind: 'err', reason: sp.reason ?? 'unknown' }
            : null
      }
    />
  )
}
