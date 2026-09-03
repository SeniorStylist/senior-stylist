-- 0046 — Realm-level QuickBooks connections (one authorization covers every
-- facility in the same QuickBooks company).
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0046_qb_connections.sql
-- Self-bootstrapped by src/lib/qb-connection.ts::ensureQbConnectionsSchema() — keep in sync.
--
-- Before this, OAuth tokens lived on each facilities row, so every facility had
-- to click Connect separately even though production QuickBooks is ONE company
-- file holding every facility as a parent customer. Intuit rotates the refresh
-- token on every refresh, so two rows holding "the same" token would race and
-- invalidate each other — tokens must live exactly once per realm.
--
-- facilities.qb_realm_id is the ATTACHMENT (which company a facility belongs
-- to); the tokens, cursors and the refresh lease live here. The legacy
-- facilities.qb_access_token / qb_refresh_token columns are backfilled into
-- this table once and no longer written.

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
);
ALTER TABLE qb_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON qb_connections;
CREATE POLICY "service_role_all" ON qb_connections FOR ALL TO service_role USING (true) WITH CHECK (true);

-- One-time backfill from the legacy per-facility token columns. Idempotent:
-- a realm that already has a connection row is left alone.
INSERT INTO qb_connections (realm_id, access_token, refresh_token, token_expires_at, refresh_token_issued_at, connected_at)
SELECT qb_realm_id, qb_access_token, qb_refresh_token, qb_token_expires_at, COALESCE(updated_at, now()), COALESCE(updated_at, now())
FROM facilities
WHERE qb_realm_id IS NOT NULL AND qb_refresh_token IS NOT NULL
ORDER BY updated_at DESC NULLS LAST
ON CONFLICT (realm_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS facilities_qb_realm_idx ON facilities (qb_realm_id) WHERE qb_realm_id IS NOT NULL;
