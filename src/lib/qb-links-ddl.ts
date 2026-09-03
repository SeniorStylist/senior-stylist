// Self-bootstrapping DDL for qb_customer_links + qb_sync_state (QB API sync).
// Keep in sync with drizzle/0043_qb_links.sql. Called at the top of every
// route/lib that touches these tables (customer sync, invoice push, payment
// sync, the nightly cron, and syncQBInvoices' numeric matching) so deploys are
// safe before the migration is applied. Same pattern as unapplied-ddl.ts.

import { db } from '@/db'
import { sql } from 'drizzle-orm'

let ddlEnsured = false

export async function ensureQbLinksSchema(): Promise<void> {
  if (ddlEnsured) return
  await db.execute(sql`
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
    )
  `)
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS qb_customer_links_resident_uq ON qb_customer_links (facility_id, resident_id) WHERE resident_id IS NOT NULL`,
  )
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS qb_customer_links_parent_uq ON qb_customer_links (facility_id) WHERE resident_id IS NULL`,
  )
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS qb_customer_links_qbid_idx ON qb_customer_links (facility_id, qb_customer_id)`,
  )
  await db.execute(sql`ALTER TABLE qb_customer_links ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`DROP POLICY IF EXISTS service_role_all ON qb_customer_links`)
  await db.execute(
    sql`CREATE POLICY "service_role_all" ON qb_customer_links FOR ALL TO service_role USING (true) WITH CHECK (true)`,
  )

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS qb_sync_state (
      facility_id uuid PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
      qb_service_item_id text,
      payments_sync_cursor text,
      payments_last_synced_at timestamptz,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    )
  `)
  await db.execute(sql`ALTER TABLE qb_sync_state ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`DROP POLICY IF EXISTS service_role_all ON qb_sync_state`)
  await db.execute(
    sql`CREATE POLICY "service_role_all" ON qb_sync_state FOR ALL TO service_role USING (true) WITH CHECK (true)`,
  )
  ddlEnsured = true
}
