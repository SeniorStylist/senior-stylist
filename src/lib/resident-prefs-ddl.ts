// P36 — self-bootstraps resident_preferences (module guard, feedback-ddl
// pattern). Keep in sync with drizzle/0029_resident_preferences.sql.
import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

export async function ensureResidentPrefsSchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS resident_preferences (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        resident_id uuid NOT NULL UNIQUE REFERENCES residents(id) ON DELETE CASCADE,
        style_notes text,
        allergy_notes text,
        preferred_stylist_id uuid REFERENCES stylists(id) ON DELETE SET NULL,
        visit_frequency text,
        email_reminders boolean NOT NULL DEFAULT true,
        sms_reminders boolean NOT NULL DEFAULT true,
        updated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await db.execute(sql`ALTER TABLE resident_preferences ENABLE ROW LEVEL SECURITY`)
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies WHERE tablename = 'resident_preferences' AND policyname = 'service_role_all'
        ) THEN
          CREATE POLICY "service_role_all" ON resident_preferences FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
      END $$
    `)
  } catch (err) {
    _ensured = false
    console.error('[resident-prefs-ddl] ensure failed:', err)
  }
}
