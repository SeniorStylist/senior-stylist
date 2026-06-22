-- Wave 2 & 3 schema additions (idempotent — safe to re-run)

-- 13A: changelog read-state on profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS changelog_last_read_at timestamptz;

-- 13E: per-facility opt-in daily digest
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS daily_digest_enabled boolean NOT NULL DEFAULT false;

-- 13G: resident profile photo (path in private bucket resident-photos)
ALTER TABLE residents ADD COLUMN IF NOT EXISTS photo_path text;

-- 13J: service sort order within category
ALTER TABLE services ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- 13Q: web push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'push_subscriptions' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON push_subscriptions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);
