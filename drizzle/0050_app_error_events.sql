-- P62 — in-app record of server render errors, so the owner can read the cause
-- of an error card ("ref 3531942187") without opening the platform logs.
--
-- No foreign keys on purpose: this must still record an error about a facility
-- that was just deleted, and a diagnostic table must never be able to block a
-- write. Pruned to 14 days by the read route.
--
-- Idempotent. Also applied at runtime by
-- src/lib/error-events-ddl.ts::ensureErrorEventsSchema() — keep the two in sync.
--
-- Apply with: psql "$DIRECT_URL" -f drizzle/0050_app_error_events.sql

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

CREATE INDEX IF NOT EXISTS app_error_events_created_idx ON app_error_events (created_at DESC);

ALTER TABLE app_error_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_all" ON app_error_events FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
