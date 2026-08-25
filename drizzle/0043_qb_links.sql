-- 0043 — QuickBooks API sync link tables (customer sync + payment-sync state).
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0043_qb_links.sql
-- Self-bootstrapped by src/lib/qb-links-ddl.ts::ensureQbLinksSchema() — keep in sync.
--
-- qb_customer_links maps residents (and the facility parent customer when
-- resident_id IS NULL) to their NUMERIC Intuit Customer.Id. residents.qb_customer_id
-- deliberately keeps its display-name meaning ("F177:Smith, Margaret - 12") —
-- the CSV contacts importer, invoice-pull matching, and payments matching all
-- key on it. Numeric ids live ONLY here.
--
-- qb_sync_state holds per-facility QB config/cursors that would otherwise be
-- hot-table columns on facilities (P19 rule: no new columns on hot tables).

CREATE TABLE IF NOT EXISTS qb_customer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  resident_id uuid REFERENCES residents(id) ON DELETE CASCADE,
  qb_customer_id text NOT NULL,
  qb_display_name text,
  qb_sync_token text,
  qb_parent_id text,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS qb_customer_links_resident_uq
  ON qb_customer_links (facility_id, resident_id) WHERE resident_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS qb_customer_links_parent_uq
  ON qb_customer_links (facility_id) WHERE resident_id IS NULL;
CREATE INDEX IF NOT EXISTS qb_customer_links_qbid_idx
  ON qb_customer_links (facility_id, qb_customer_id);
ALTER TABLE qb_customer_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON qb_customer_links;
CREATE POLICY "service_role_all" ON qb_customer_links FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS qb_sync_state (
  facility_id uuid PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
  qb_service_item_id text,
  payments_sync_cursor text,
  payments_last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE qb_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON qb_sync_state;
CREATE POLICY "service_role_all" ON qb_sync_state FOR ALL TO service_role USING (true) WITH CHECK (true);
