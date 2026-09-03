// Realm-level QuickBooks connection — ONE authorization covers every facility
// that lives in the same QuickBooks company ("realm").
//
// Why realm-level: production QuickBooks is a single company file where every
// facility is a parent customer, and Intuit ROTATES the refresh token on every
// refresh. Per-facility token copies of one realm would race each other into
// `invalid_grant` the first night two of them refreshed. So tokens live exactly
// once per realm here (`qb_connections`), every refresh goes through a DB
// lease (`refresh_lock_until`) so concurrent lambdas can't double-refresh, and
// facilities merely ATTACH through the existing `facilities.qb_realm_id`
// column (no new hot-table columns — P19).
//
// Per-facility things stay per facility: expense account, F-code parent
// customer link, invoice/payment sync cursors, sync history.

import { db } from '@/db'
import { facilities, franchiseFacilities, qbConnections } from '@/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { decryptToken, encryptToken } from '@/lib/token-crypto'
import { refreshQBTokens, revokeQBRefreshToken, type QBTokens } from '@/lib/qb-oauth-http'

const REFRESH_SKEW_MS = 5 * 60 * 1000
const LEASE_SECONDS = 45
const LEASE_WAIT_MS = 20_000

let ddlEnsured = false

/** Self-bootstrapping DDL — keep in sync with drizzle/0046_qb_connections.sql. */
export async function ensureQbConnectionsSchema(): Promise<void> {
  if (ddlEnsured) return
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS qb_connections (
      realm_id text PRIMARY KEY,
      access_token text,
      refresh_token text,
      token_expires_at timestamptz,
      refresh_token_issued_at timestamptz,
      refresh_token_expires_at timestamptz,
      company_name text,
      connected_by uuid,
      connected_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      last_error text,
      refresh_lock_until timestamptz,
      invoices_sync_cursor text,
      invoices_last_synced_at timestamptz,
      payments_sync_cursor text,
      payments_last_synced_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`ALTER TABLE qb_connections ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`DROP POLICY IF EXISTS service_role_all ON qb_connections`)
  await db.execute(
    sql`CREATE POLICY "service_role_all" ON qb_connections FOR ALL TO service_role USING (true) WITH CHECK (true)`,
  )
  // One-time backfill from the legacy per-facility token columns (idempotent).
  await db.execute(sql`
    INSERT INTO qb_connections (realm_id, access_token, refresh_token, token_expires_at, refresh_token_issued_at, connected_at)
    SELECT qb_realm_id, qb_access_token, qb_refresh_token, qb_token_expires_at, COALESCE(updated_at, now()), COALESCE(updated_at, now())
    FROM facilities
    WHERE qb_realm_id IS NOT NULL AND qb_refresh_token IS NOT NULL
    ORDER BY updated_at DESC NULLS LAST
    ON CONFLICT (realm_id) DO NOTHING
  `)
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS facilities_qb_realm_idx ON facilities (qb_realm_id) WHERE qb_realm_id IS NOT NULL`,
  )
  ddlEnsured = true
}

/** SQL fragment: is the facilities row (outer query) attached to a live connection? */
export const qbConnectedSql = sql<boolean>`EXISTS (
  SELECT 1 FROM qb_connections c
  WHERE c.realm_id = ${facilities.qbRealmId} AND c.refresh_token IS NOT NULL AND c.revoked_at IS NULL
)`

export interface QbConnectionInfo {
  realmId: string
  companyName: string | null
  connectedAt: string
  connectedBy: string | null
  tokenExpiresAt: string | null
  refreshTokenIssuedAt: string | null
  /** Intuit refresh tokens live 100 days from issue; surfaced so the UI can warn. */
  refreshTokenExpiresAt: string | null
  revokedAt: string | null
  lastError: string | null
  connected: boolean
}

// Intuit's historic rule (100 days from issue) — used only when the token
// response didn't carry x_refresh_token_expires_in.
const REFRESH_TOKEN_LIFETIME_MS = 100 * 24 * 60 * 60 * 1000

function toInfo(row: typeof qbConnections.$inferSelect): QbConnectionInfo {
  const issued = row.refreshTokenIssuedAt ?? row.connectedAt
  const refreshExpires =
    row.refreshTokenExpiresAt ?? (issued ? new Date(issued.getTime() + REFRESH_TOKEN_LIFETIME_MS) : null)
  return {
    realmId: row.realmId,
    companyName: row.companyName,
    connectedAt: row.connectedAt.toISOString(),
    connectedBy: row.connectedBy,
    tokenExpiresAt: row.tokenExpiresAt?.toISOString() ?? null,
    refreshTokenIssuedAt: row.refreshTokenIssuedAt?.toISOString() ?? null,
    refreshTokenExpiresAt: refreshExpires?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastError: row.lastError,
    connected: !!row.refreshToken && !row.revokedAt,
  }
}

/** Token-free view of a connection (safe for client payloads). */
export async function getConnectionInfo(realmId: string): Promise<QbConnectionInfo | null> {
  await ensureQbConnectionsSchema()
  const row = await db.query.qbConnections.findFirst({ where: eq(qbConnections.realmId, realmId) })
  return row ? toInfo(row) : null
}

/** Every connection (token-free), live ones first. */
export async function listConnections(): Promise<QbConnectionInfo[]> {
  await ensureQbConnectionsSchema()
  const rows = await db.query.qbConnections.findMany()
  return rows.map(toInfo).sort((a, b) => Number(b.connected) - Number(a.connected))
}

export async function getFacilityRealm(facilityId: string): Promise<string | null> {
  const f = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { qbRealmId: true },
  })
  return f?.qbRealmId ?? null
}

/** Attached to a realm whose connection is live (has a refresh token, not revoked). */
export async function isFacilityConnected(facilityId: string): Promise<boolean> {
  await ensureQbConnectionsSchema()
  const rows = (await db.execute(sql`
    SELECT 1 FROM facilities f
    JOIN qb_connections c ON c.realm_id = f.qb_realm_id
    WHERE f.id = ${facilityId}::uuid AND c.refresh_token IS NOT NULL AND c.revoked_at IS NULL
    LIMIT 1
  `)) as unknown as unknown[]
  return rows.length > 0
}

/** Map facilityId → connected for a set of facilities (ONE query). */
export async function connectedMap(facilityIds: string[]): Promise<Map<string, boolean>> {
  await ensureQbConnectionsSchema()
  if (facilityIds.length === 0) return new Map()
  const rows = await db
    .select({ id: facilities.id, connected: qbConnectedSql })
    .from(facilities)
    .where(inArray(facilities.id, facilityIds))
  return new Map(rows.map((r) => [r.id, r.connected === true]))
}

/** Persist a fresh authorization for a realm (creates or re-activates). */
export async function saveConnection(opts: {
  realmId: string
  tokens: QBTokens
  userId: string | null
  companyName?: string | null
}): Promise<void> {
  await ensureQbConnectionsSchema()
  const now = new Date()
  await db
    .insert(qbConnections)
    .values({
      realmId: opts.realmId,
      accessToken: encryptToken(opts.tokens.accessToken),
      refreshToken: encryptToken(opts.tokens.refreshToken),
      tokenExpiresAt: new Date(now.getTime() + opts.tokens.expiresIn * 1000),
      refreshTokenIssuedAt: now,
      refreshTokenExpiresAt: opts.tokens.refreshExpiresIn
        ? new Date(now.getTime() + opts.tokens.refreshExpiresIn * 1000)
        : null,
      companyName: opts.companyName ?? null,
      connectedBy: opts.userId,
      connectedAt: now,
      revokedAt: null,
      lastError: null,
      refreshLockUntil: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: qbConnections.realmId,
      set: {
        accessToken: sql`excluded.access_token`,
        refreshToken: sql`excluded.refresh_token`,
        tokenExpiresAt: sql`excluded.token_expires_at`,
        refreshTokenIssuedAt: sql`excluded.refresh_token_issued_at`,
        refreshTokenExpiresAt: sql`excluded.refresh_token_expires_at`,
        companyName: sql`COALESCE(excluded.company_name, ${qbConnections.companyName})`,
        connectedBy: sql`excluded.connected_by`,
        connectedAt: sql`excluded.connected_at`,
        revokedAt: null,
        lastError: null,
        refreshLockUntil: null,
        updatedAt: now,
      },
    })
}

export async function setCompanyName(realmId: string, companyName: string): Promise<void> {
  await db
    .update(qbConnections)
    .set({ companyName, updatedAt: new Date() })
    .where(eq(qbConnections.realmId, realmId))
}

// ── Access tokens ─────────────────────────────────────────────────────────

type TokenRow = { access_token: string | null; refresh_token: string | null; token_expires_at: Date | string | null }

/** After a failed refresh, don't hammer Intuit with the same dead token on
 *  every request — surface the stored error for this long instead. */
const FAILED_REFRESH_BACKOFF_MS = 60_000

function isFresh(row: TokenRow): boolean {
  if (!row.access_token || !row.token_expires_at) return false
  const t = new Date(row.token_expires_at).getTime()
  return t - REFRESH_SKEW_MS > Date.now()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Same-instance dedupe (the DB lease handles cross-instance).
const inFlight = new Map<string, Promise<string>>()

/**
 * A valid access token for the realm, refreshing through the DB lease when
 * needed. Intuit rotates the refresh token on every refresh, so exactly ONE
 * worker may refresh at a time; the others wait for its result.
 */
export function getAccessToken(realmId: string): Promise<string> {
  const existing = inFlight.get(realmId)
  if (existing) return existing
  const p = doGetAccessToken(realmId).finally(() => inFlight.delete(realmId))
  inFlight.set(realmId, p)
  return p
}

async function doGetAccessToken(realmId: string): Promise<string> {
  await ensureQbConnectionsSchema()
  type Row = TokenRow & { revoked_at: Date | string | null; last_error: string | null; updated_at: Date | string | null }
  const readRow = async (): Promise<Row> => {
    const rows = (await db.execute(sql`
      SELECT access_token, refresh_token, token_expires_at, revoked_at, last_error, updated_at
      FROM qb_connections WHERE realm_id = ${realmId}
    `)) as unknown as Row[]
    const row = rows[0]
    if (!row || !row.refresh_token || row.revoked_at) throw new Error('QuickBooks not connected')
    return row
  }

  const first = await readRow()
  if (isFresh(first)) return decryptToken(first.access_token!)
  if (first.last_error && first.updated_at && Date.now() - new Date(first.updated_at).getTime() < FAILED_REFRESH_BACKOFF_MS) {
    // Same wording the status route maps to "reconnect_needed".
    throw new Error(`QB token refresh failed recently: ${first.last_error}`)
  }

  const deadline = Date.now() + LEASE_WAIT_MS
  while (true) {
    // Atomic lease: only one worker across all instances gets to refresh.
    const claimed = (await db.execute(sql`
      UPDATE qb_connections
      SET refresh_lock_until = now() + (${LEASE_SECONDS}::int * interval '1 second')
      WHERE realm_id = ${realmId}
        AND revoked_at IS NULL
        AND (refresh_lock_until IS NULL OR refresh_lock_until < now())
      RETURNING access_token, refresh_token, token_expires_at
    `)) as unknown as TokenRow[]
    const cur = claimed[0]
    if (cur) {
      try {
        // Another worker may have refreshed between our read and the lease —
        // hand the lease straight back so nobody waits out the 45s.
        if (isFresh(cur)) {
          await db
            .execute(sql`UPDATE qb_connections SET refresh_lock_until = NULL WHERE realm_id = ${realmId}`)
            .catch(() => {})
          return decryptToken(cur.access_token!)
        }
        if (!cur.refresh_token) throw new Error('QuickBooks not connected')
        const oldRefresh = decryptToken(cur.refresh_token)
        const data = await refreshQBTokens(oldRefresh)
        // Intuit rotates the refresh token (~daily) and kills the superseded one
        // within 24h — the value we just received is the ONLY valid one now.
        const rotated = data.refreshToken !== oldRefresh
        const refreshExpiresSec = data.refreshExpiresIn ?? null
        await db.execute(sql`
          UPDATE qb_connections SET
            access_token = ${encryptToken(data.accessToken)},
            refresh_token = ${encryptToken(data.refreshToken)},
            token_expires_at = now() + (${data.expiresIn}::int * interval '1 second'),
            refresh_token_issued_at = CASE WHEN ${rotated}::boolean THEN now() ELSE COALESCE(refresh_token_issued_at, now()) END,
            refresh_token_expires_at = CASE
              WHEN ${refreshExpiresSec}::int IS NOT NULL THEN now() + (${refreshExpiresSec}::int * interval '1 second')
              ELSE refresh_token_expires_at
            END,
            last_error = NULL,
            refresh_lock_until = NULL,
            updated_at = now()
          WHERE realm_id = ${realmId}
        `)
        return data.accessToken
      } catch (err) {
        const message = ((err as Error).message ?? 'refresh failed').slice(0, 500)
        await db
          .execute(sql`
            UPDATE qb_connections SET last_error = ${message}, refresh_lock_until = NULL, updated_at = now()
            WHERE realm_id = ${realmId}
          `)
          .catch(() => {})
        throw err
      }
    }
    // Someone else holds the lease — wait for their result.
    if (Date.now() > deadline) throw new Error('QB token refresh is already in progress — try again in a moment')
    await sleep(500)
    const again = await readRow()
    if (isFresh(again)) return decryptToken(again.access_token!)
  }
}

/** Force the next call to refresh (used after a 401 from Intuit). */
export async function markAccessTokenExpired(realmId: string): Promise<void> {
  await db
    .update(qbConnections)
    .set({ tokenExpiresAt: new Date(0), updatedAt: new Date() })
    .where(eq(qbConnections.realmId, realmId))
}

// ── Attach / detach / disconnect ──────────────────────────────────────────

export type ConnectScope = 'facility' | 'franchise' | 'all'

/** Facilities a scope resolves to. `facilityId` anchors 'facility' and 'franchise'. */
export async function facilityIdsForScope(scope: ConnectScope, facilityId: string | null): Promise<string[]> {
  if (scope === 'facility') return facilityId ? [facilityId] : []
  if (scope === 'franchise') {
    if (!facilityId) return []
    const membership = await db.query.franchiseFacilities.findFirst({
      where: eq(franchiseFacilities.facilityId, facilityId),
      columns: { franchiseId: true },
    })
    if (!membership) return [facilityId]
    const siblings = await db.query.franchiseFacilities.findMany({
      where: eq(franchiseFacilities.franchiseId, membership.franchiseId),
      columns: { facilityId: true },
    })
    return siblings.map((s) => s.facilityId)
  }
  const all = await db.query.facilities.findMany({
    where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
    columns: { id: true },
  })
  return all.map((f) => f.id)
}

/**
 * Attach facilities to a realm. Never steals a facility already attached to a
 * DIFFERENT realm (a franchise with its own QuickBooks file keeps it) — those
 * come back in `skipped`. Legacy per-facility token columns are cleared so
 * nothing can read a stale copy.
 */
export async function attachFacilities(
  realmId: string,
  facilityIds: string[],
): Promise<{ attached: string[]; alreadyAttached: string[]; skipped: Array<{ id: string; realmId: string }> }> {
  await ensureQbConnectionsSchema()
  if (facilityIds.length === 0) return { attached: [], alreadyAttached: [], skipped: [] }
  const rows = await db.query.facilities.findMany({
    where: inArray(facilities.id, facilityIds),
    columns: { id: true, qbRealmId: true },
  })
  const attached: string[] = []
  const alreadyAttached: string[] = []
  const skipped: Array<{ id: string; realmId: string }> = []
  for (const f of rows) {
    if (!f.qbRealmId) attached.push(f.id)
    else if (f.qbRealmId === realmId) alreadyAttached.push(f.id)
    else skipped.push({ id: f.id, realmId: f.qbRealmId })
  }
  const toWrite = [...attached, ...alreadyAttached]
  if (toWrite.length > 0) {
    await db
      .update(facilities)
      .set({
        qbRealmId: realmId,
        qbAccessToken: null,
        qbRefreshToken: null,
        qbTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(inArray(facilities.id, toWrite))
  }
  return { attached, alreadyAttached, skipped }
}

/**
 * Detach ONE facility from its realm (the connection stays live for the
 * others). Clears that facility's expense account + sync cursors so a later
 * attachment to a different company starts clean; customer links stay (a
 * re-attach to the same realm is the common case).
 */
export async function detachFacility(facilityId: string): Promise<void> {
  await ensureQbConnectionsSchema()
  await db
    .update(facilities)
    .set({
      qbRealmId: null,
      qbAccessToken: null,
      qbRefreshToken: null,
      qbTokenExpiresAt: null,
      qbExpenseAccountId: null,
      qbInvoicesSyncCursor: null,
      qbInvoicesLastSyncedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(facilities.id, facilityId))
  await db
    .execute(
      sql`UPDATE qb_sync_state SET payments_sync_cursor = NULL, payments_last_synced_at = NULL, updated_at = now() WHERE facility_id = ${facilityId}::uuid`,
    )
    .catch(() => {})
}

/**
 * Disconnect the whole company: revoke at Intuit (best-effort), mark the
 * connection revoked, and detach EVERY facility in the realm.
 */
export async function disconnectRealm(realmId: string): Promise<{ detached: number }> {
  await ensureQbConnectionsSchema()
  const row = await db.query.qbConnections.findFirst({
    where: eq(qbConnections.realmId, realmId),
    columns: { refreshToken: true },
  })
  // Detach every attached facility in TWO statements (never a per-facility
  // loop — max:1 pool; a 100-facility realm would be 200 round-trips).
  const detached = await db
    .update(facilities)
    .set({
      qbRealmId: null,
      qbAccessToken: null,
      qbRefreshToken: null,
      qbTokenExpiresAt: null,
      qbExpenseAccountId: null,
      qbInvoicesSyncCursor: null,
      qbInvoicesLastSyncedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(facilities.qbRealmId, realmId))
    .returning({ id: facilities.id })
  if (detached.length > 0) {
    await db
      .execute(sql`
        UPDATE qb_sync_state SET payments_sync_cursor = NULL, payments_last_synced_at = NULL, updated_at = now()
        WHERE facility_id IN (${sql.join(detached.map((d) => sql`${d.id}::uuid`), sql`, `)})
      `)
      .catch(() => {})
  }
  await db
    .update(qbConnections)
    .set({
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      revokedAt: new Date(),
      refreshLockUntil: null,
      invoicesSyncCursor: null,
      invoicesLastSyncedAt: null,
      paymentsSyncCursor: null,
      paymentsLastSyncedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(qbConnections.realmId, realmId))
  if (row?.refreshToken) {
    try {
      await revokeQBRefreshToken(decryptToken(row.refreshToken))
    } catch (err) {
      console.error('[qb-connection] revoke failed (non-fatal):', err)
    }
  }
  return { detached: detached.length }
}

/** Facilities attached to a realm (id, name, code) — for the attach UI + realm sync. */
export async function listRealmFacilities(realmId: string): Promise<Array<{ id: string; name: string; facilityCode: string | null }>> {
  const rows = await db.query.facilities.findMany({
    where: and(eq(facilities.qbRealmId, realmId), eq(facilities.active, true), eq(facilities.isDemo, false)),
    columns: { id: true, name: true, facilityCode: true },
    orderBy: facilities.name,
  })
  return rows
}
