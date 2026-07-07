import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

/** Phase 19 — self-bootstraps user_prefs. Keep in sync with drizzle/0026_user_prefs.sql. */
export async function ensureUserPrefsSchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_prefs (
        user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        mobile_nav jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `)
    await db.execute(sql`ALTER TABLE user_prefs ENABLE ROW LEVEL SECURITY;`)
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_prefs' AND policyname='service_role_all') THEN
          CREATE POLICY "service_role_all" ON user_prefs FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `)
  } catch {
    _ensured = false
  }
}
