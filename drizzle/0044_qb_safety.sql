-- 0044 — QuickBooks safety: site-paid protection + per-run undo.
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0044_qb_safety.sql
-- Self-bootstrapped by src/lib/qb-safety-ddl.ts::ensureQbSafetySchema() — keep in sync.
--
-- qb_invoice_site_payments: how much of each invoice was collected ON THE SITE
-- (card/in-app/portal/salon credit/credit application) and therefore may not yet
-- be reflected in QuickBooks. Every QB-authoritative overwrite (nightly pull, CSV
-- import) re-applies it so a family that already paid on the site is never
-- re-billed or re-charged when QuickBooks still shows the invoice open.
--   local_open = max(0, min(qb_open, qb_amount - site_paid))
--
-- qb_sync_runs: one row per QB operation with enough detail to UNDO it
-- (void pushed invoices, deactivate created customers, revert pulled
-- payments/credits, restore pre-pull balances + cursors).

CREATE TABLE IF NOT EXISTS qb_invoice_site_payments (
  invoice_id uuid PRIMARY KEY REFERENCES qb_invoices(id) ON DELETE CASCADE,
  site_paid_cents integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE qb_invoice_site_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON qb_invoice_site_payments;
CREATE POLICY "service_role_all" ON qb_invoice_site_payments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS qb_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  action text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz DEFAULT now(),
  created_by uuid,
  summary jsonb,
  items jsonb,
  undone_at timestamptz,
  undone_by uuid,
  undo_summary jsonb
);
CREATE INDEX IF NOT EXISTS qb_sync_runs_facility_idx ON qb_sync_runs (facility_id, started_at DESC);
ALTER TABLE qb_sync_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON qb_sync_runs;
CREATE POLICY "service_role_all" ON qb_sync_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
