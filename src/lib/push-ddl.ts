import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

export async function ensurePushSchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  // Idempotent — kept in sync with drizzle/0014_wave2_wave3.sql
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      endpoint text NOT NULL,
      p256dh text NOT NULL,
      auth text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_user_endpoint_unique ON push_subscriptions(user_id, endpoint);
    CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);
    ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='push_subscriptions' AND policyname='service_role_all') THEN
        CREATE POLICY "service_role_all" ON push_subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);
      END IF;
    END $$;
  `).catch(() => { _ensured = false })
}
