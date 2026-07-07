-- Phase 19 — server-synced per-user preferences (mobile nav tab picks).
-- New TABLE (not a column on profiles) so deploys are order-proof: full-row
-- selects on existing tables never see an unknown column.
-- Idempotent; also self-bootstrapped by src/lib/user-prefs-ddl.ts (keep in sync).
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  mobile_nav jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_prefs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_prefs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON user_prefs FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
