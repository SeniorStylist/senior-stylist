// P36 — self-bootstraps the resident_merge_log audit table (module-level guard,
// same pattern as feedback-ddl.ts). Keep the inline DDL in sync with
// drizzle/0028_resident_merge_log.sql.
import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

export async function ensureResidentMergeSchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS resident_merge_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_at timestamptz NOT NULL DEFAULT now(),
        performed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
        facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
        keep_resident_id uuid,
        merged_resident_id uuid,
        merged_resident_name text NOT NULL,
        moved jsonb NOT NULL DEFAULT '{}'::jsonb,
        fields_inherited text[] NOT NULL DEFAULT '{}'::text[],
        cards_left_behind integer NOT NULL DEFAULT 0,
        notes text
      )
    `)
    await db.execute(sql`ALTER TABLE resident_merge_log ENABLE ROW LEVEL SECURITY`)
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE tablename = 'resident_merge_log' AND policyname = 'service_role_all'
        ) THEN
          CREATE POLICY "service_role_all" ON resident_merge_log FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
      END $$
    `)
  } catch (err) {
    _ensured = false // retry on next call
    console.error('[resident-merge-ddl] ensure failed:', err)
  }
}
