-- Payments: Card-On-File auto-collect + in-app stylist card processing.
-- Idempotent. Apply with: psql "$DIRECT_URL" -f drizzle/0016_payments_cof.sql
-- Keep in sync with src/lib/payments-ddl.ts::ensurePaymentsSchema().

-- residents: Stripe customer + per-resident auto-collect config
ALTER TABLE residents ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS autopay_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE residents ADD COLUMN IF NOT EXISTS autopay_method text;

-- facilities: facility-level auto-collect config
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS autopay_mode text NOT NULL DEFAULT 'manual';
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS autopay_sweep_cadence text NOT NULL DEFAULT 'off';
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS autopay_last_swept_at timestamptz;

-- qb_payments: Stripe charge linkage + in-app collector
ALTER TABLE qb_payments ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
ALTER TABLE qb_payments ADD COLUMN IF NOT EXISTS collected_by uuid;

-- bookings: auto-collect audit trail
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS autopay_attempted_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS autopay_last_error text;

-- payment_methods: saved cards (tokens only — no PAN/CVC ever stored)
CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_payment_method_id text NOT NULL,
  brand text,
  last4 text,
  exp_month integer,
  exp_year integer,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_methods_resident_active_idx ON payment_methods (resident_id) WHERE active = true;
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_stripe_pm_unique ON payment_methods (stripe_payment_method_id);
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON payment_methods;
CREATE POLICY "service_role_all" ON payment_methods FOR ALL TO service_role USING (true) WITH CHECK (true);
