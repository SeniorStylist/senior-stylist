-- 0045 — QuickBooks payment mirroring (site/Stripe payments → QB Payment objects).
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0045_qb_payment_mirror.sql
-- Self-bootstrapped by src/lib/qb-safety-ddl.ts::ensureQbSafetySchema() — keep in sync.
--
-- qb_payment_mirror_queue: one row per site-collected card payment (card on
-- file, in-app, family portal) that applied money to QB-known invoices. The
-- mirror worker creates the matching QuickBooks Payment (linked to the same
-- invoices), stamps qb_payments.qb_payment_id, and reduces the site-paid clamp
-- by the mirrored amount. Rows are claimed atomically and retried by the
-- nightly cron; `ref` (PaymentRefNum in QB, ≤21 chars) is the crash-safe
-- dedup key — a payment created in QB but not finalized locally is adopted
-- on the next attempt instead of created twice.

CREATE TABLE IF NOT EXISTS qb_payment_mirror_queue (
  payment_id uuid PRIMARY KEY REFERENCES qb_payments(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  resident_id uuid REFERENCES residents(id) ON DELETE SET NULL,
  amount_cents integer NOT NULL,
  allocations jsonb NOT NULL DEFAULT '[]',
  ref text NOT NULL,
  source text,
  stripe_payment_intent_id text,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  skip_reason text,
  qb_payment_id text,
  mirrored_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  mirrored_at timestamptz
);
CREATE INDEX IF NOT EXISTS qb_payment_mirror_queue_status_idx ON qb_payment_mirror_queue (facility_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS qb_payment_mirror_queue_ref_uq ON qb_payment_mirror_queue (ref);
ALTER TABLE qb_payment_mirror_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all ON qb_payment_mirror_queue;
CREATE POLICY "service_role_all" ON qb_payment_mirror_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Cached QB PaymentMethod id for "Credit Card" (looked up once per facility).
ALTER TABLE qb_sync_state ADD COLUMN IF NOT EXISTS qb_card_payment_method_id text;
