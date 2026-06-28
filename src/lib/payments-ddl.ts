// Self-bootstrapping DDL for the Payments (Card-On-File) feature. The dev
// environment has no DB credentials for psql, so the routes that touch these
// columns/tables apply the idempotent DDL once per lambda instance (module-level
// guard, same pattern as unapplied-ddl.ts / feedback-ddl.ts).
// Keep in sync with drizzle/0016_payments_cof.sql.

import { db } from '@/db'
import { sql } from 'drizzle-orm'

let ddlEnsured = false

export async function ensurePaymentsSchema(): Promise<void> {
  if (ddlEnsured) return

  // residents — Stripe customer + per-resident auto-collect config
  await db.execute(sql`ALTER TABLE residents ADD COLUMN IF NOT EXISTS stripe_customer_id text`)
  await db.execute(sql`ALTER TABLE residents ADD COLUMN IF NOT EXISTS autopay_enabled boolean NOT NULL DEFAULT false`)
  await db.execute(sql`ALTER TABLE residents ADD COLUMN IF NOT EXISTS autopay_method text`)

  // facilities — facility-level auto-collect config
  await db.execute(sql`ALTER TABLE facilities ADD COLUMN IF NOT EXISTS autopay_mode text NOT NULL DEFAULT 'manual'`)
  await db.execute(sql`ALTER TABLE facilities ADD COLUMN IF NOT EXISTS autopay_sweep_cadence text NOT NULL DEFAULT 'off'`)
  await db.execute(sql`ALTER TABLE facilities ADD COLUMN IF NOT EXISTS autopay_last_swept_at timestamptz`)

  // qb_payments — Stripe charge linkage + in-app collector
  await db.execute(sql`ALTER TABLE qb_payments ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text`)
  await db.execute(sql`ALTER TABLE qb_payments ADD COLUMN IF NOT EXISTS collected_by uuid`)

  // bookings — auto-collect audit trail
  await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS autopay_attempted_at timestamptz`)
  await db.execute(sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS autopay_last_error text`)

  // payment_methods — saved cards (tokens only)
  await db.execute(sql`
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
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS payment_methods_resident_active_idx ON payment_methods (resident_id) WHERE active = true`)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_stripe_pm_unique ON payment_methods (stripe_payment_method_id)`)
  await db.execute(sql`ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`DROP POLICY IF EXISTS service_role_all ON payment_methods`)
  await db.execute(sql`CREATE POLICY "service_role_all" ON payment_methods FOR ALL TO service_role USING (true) WITH CHECK (true)`)

  ddlEnsured = true
}
