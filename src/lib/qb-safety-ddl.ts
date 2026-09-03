// Self-bootstrapping DDL for qb_invoice_site_payments + qb_sync_runs.
// Keep in sync with drizzle/0044_qb_safety.sql. Called BEFORE any transaction
// at every entry point that writes to these tables (card charge, in-app
// finalize, Stripe webhook, credit application, the QB sync libs) — a DDL
// statement inside a transaction would abort it, and a missing table must
// never make a payment fail to record.

import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { ensureQbLinksSchema } from '@/lib/qb-links-ddl'

let ddlEnsured = false

export async function ensureQbSafetySchema(): Promise<void> {
  if (ddlEnsured) return
  // qb_sync_state (0043) must exist before the 0045 ALTER below.
  await ensureQbLinksSchema()
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS qb_invoice_site_payments (
      invoice_id uuid PRIMARY KEY REFERENCES qb_invoices(id) ON DELETE CASCADE,
      site_paid_cents integer NOT NULL DEFAULT 0,
      updated_at timestamptz DEFAULT now()
    )
  `)
  await db.execute(sql`ALTER TABLE qb_invoice_site_payments ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`DROP POLICY IF EXISTS service_role_all ON qb_invoice_site_payments`)
  await db.execute(
    sql`CREATE POLICY "service_role_all" ON qb_invoice_site_payments FOR ALL TO service_role USING (true) WITH CHECK (true)`,
  )

  await db.execute(sql`
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
    )
  `)
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS qb_sync_runs_facility_idx ON qb_sync_runs (facility_id, started_at DESC)`,
  )
  await db.execute(sql`ALTER TABLE qb_sync_runs ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`DROP POLICY IF EXISTS service_role_all ON qb_sync_runs`)
  await db.execute(
    sql`CREATE POLICY "service_role_all" ON qb_sync_runs FOR ALL TO service_role USING (true) WITH CHECK (true)`,
  )

  // 0045 — payment mirroring queue (keep in sync with drizzle/0045_qb_payment_mirror.sql)
  await db.execute(sql`
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
    )
  `)
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS qb_payment_mirror_queue_status_idx ON qb_payment_mirror_queue (facility_id, status)`,
  )
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS qb_payment_mirror_queue_ref_uq ON qb_payment_mirror_queue (ref)`,
  )
  await db.execute(sql`ALTER TABLE qb_payment_mirror_queue ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`DROP POLICY IF EXISTS service_role_all ON qb_payment_mirror_queue`)
  await db.execute(
    sql`CREATE POLICY "service_role_all" ON qb_payment_mirror_queue FOR ALL TO service_role USING (true) WITH CHECK (true)`,
  )
  await db.execute(sql`ALTER TABLE qb_sync_state ADD COLUMN IF NOT EXISTS qb_card_payment_method_id text`)
  ddlEnsured = true
}
