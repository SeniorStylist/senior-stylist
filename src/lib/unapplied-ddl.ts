// Self-bootstrapping DDL for qb_unapplied_credits. The dev environment has no DB
// credentials for psql, so the routes that touch this table apply the idempotent
// DDL once per lambda instance. Keep in sync with drizzle/0008_qb_unapplied_credits.sql
// and drizzle/0009_unapplied_apply.sql.

import { db } from '@/db'
import { sql } from 'drizzle-orm'

let ddlEnsured = false

export async function ensureUnappliedSchema(): Promise<void> {
  if (ddlEnsured) return
  await db.execute(sql`
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
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS qb_unapplied_credits_facility_idx ON qb_unapplied_credits (facility_id)`)
  await db.execute(sql`ALTER TABLE qb_unapplied_credits ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`DROP POLICY IF EXISTS service_role_all ON qb_unapplied_credits`)
  await db.execute(sql`CREATE POLICY "service_role_all" ON qb_unapplied_credits FOR ALL TO service_role USING (true) WITH CHECK (true)`)
  // 0009 — site-side application columns
  await db.execute(sql`ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_cents integer NOT NULL DEFAULT 0`)
  await db.execute(sql`ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_at timestamptz`)
  await db.execute(sql`ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_by uuid`)
  await db.execute(sql`ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_detail jsonb`)
  ddlEnsured = true
}
