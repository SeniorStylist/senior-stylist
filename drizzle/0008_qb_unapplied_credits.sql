-- Unapplied QB credits snapshot — payments/credit memos received in QuickBooks but
-- never applied to an invoice. Populated by the "Customer Balance Detail" CSV import
-- (Step 5 on /master-admin/imports/quickbooks); wiped and replaced on every import.
-- Idempotent: apply with  psql "$DIRECT_URL" -f drizzle/0008_qb_unapplied_credits.sql

CREATE TABLE IF NOT EXISTS qb_unapplied_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  resident_id uuid REFERENCES residents(id) ON DELETE SET NULL,
  qb_customer_id text NOT NULL,
  txn_type text NOT NULL DEFAULT 'Payment',
  txn_date date NOT NULL,
  num text,
  amount_cents integer NOT NULL DEFAULT 0,
  open_balance_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qb_unapplied_credits_facility_idx ON qb_unapplied_credits (facility_id);

ALTER TABLE qb_unapplied_credits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON qb_unapplied_credits;
CREATE POLICY "service_role_all" ON qb_unapplied_credits FOR ALL TO service_role USING (true) WITH CHECK (true);
