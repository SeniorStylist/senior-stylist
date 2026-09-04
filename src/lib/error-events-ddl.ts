import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

/**
 * P63 — self-bootstraps `app_error_events`, the in-app record of server render
 * errors.
 *
 * Josh's call: he should not have to open Vercel to find out why a page failed.
 * The error card already shows Next's digest ("ref 3531942187"); this table is
 * what turns that number into a sentence.
 *
 * Kept in sync with drizzle/0050_app_error_events.sql. No foreign keys on
 * purpose — this must still record an error about a facility that was just
 * deleted, and a diagnostic table should never be able to block a write.
 */
export async function ensureErrorEventsSchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS app_error_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        digest text,
        message text,
        stack text,
        path text,
        facility_id uuid,
        user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS app_error_events_created_idx ON app_error_events (created_at DESC);
    `)
    await db.execute(sql`ALTER TABLE app_error_events ENABLE ROW LEVEL SECURITY;`)
    await db.execute(sql`
      DO $$ BEGIN
        CREATE POLICY "service_role_all" ON app_error_events FOR ALL TO service_role USING (true) WITH CHECK (true);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `)
  } catch (err) {
    console.error('[error-events-ddl] bootstrap failed (continuing):', err)
  }
}
