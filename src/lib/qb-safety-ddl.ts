// Self-bootstrapping DDL for qb_invoice_site_payments + qb_sync_runs.
// Keep in sync with drizzle/0044_qb_safety.sql. Called BEFORE any transaction
// at every entry point that writes to these tables (card charge, in-app
// finalize, Stripe webhook, credit application, the QB sync libs) — a DDL
// statement inside a transaction would abort it, and a missing table must
// never make a payment fail to record.

import { db } from '@/db'
import { sql } from 'drizzle-orm'

let ddlEnsured = false

export async function ensureQbSafetySchema(): Promise<void> {
  if (ddlEnsured) return
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
  ddlEnsured = true
}
