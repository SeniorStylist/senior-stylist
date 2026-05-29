-- Phase 13-Tutorial — demo data + scripted-tour schema
--
-- WHY THIS FILE EXISTS: the Phase 13 app code queries `is_demo`,
-- `profiles.has_seen_first_tour`, `profiles.help_progress`, and the
-- `help_step_events` table. `drizzle-kit push` prompts interactively when it
-- sees the NOT NULL columns / new index, and aborts in a non-interactive shell
-- without applying — which left the deployed code 500-ing on a DB that lacked
-- these columns. This file is fully idempotent and applies cleanly with:
--
--   psql "$DIRECT_URL" -f drizzle/0001_phase13_demo_tutorial.sql
--
-- (or paste it into the Supabase SQL editor for project goomnlsdguetfgwjpwer).
-- After it runs, `drizzle-kit push` should report "No changes".

BEGIN;

-- ── demo flag on the six seeded tables ───────────────────────────────────
ALTER TABLE residents        ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE stylists         ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE services         ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE bookings         ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE log_entries      ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE stylist_checkins ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- ── profiles: first-tour autolaunch + mid-tour resume state ──────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS has_seen_first_tour boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS help_progress jsonb;

-- ── partial index for demo-record lookups / seeding ──────────────────────
CREATE INDEX IF NOT EXISTS residents_demo_idx ON residents (facility_id) WHERE is_demo = true;

-- ── help_step_events telemetry table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS help_step_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES profiles(id)   ON DELETE SET NULL,
  tour_id     text    NOT NULL,
  step_index  integer NOT NULL,
  action      text    NOT NULL, -- 'shown' | 'completed' | 'abandoned' | 'skipped'
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS help_step_events_tour_step_action_idx ON help_step_events (tour_id, step_index, action);
CREATE INDEX IF NOT EXISTS help_step_events_facility_created_idx ON help_step_events (facility_id, created_at);

-- ── RLS (project rule: every table goes through service_role) ─────────────
ALTER TABLE help_step_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON help_step_events;
CREATE POLICY "service_role_all" ON help_step_events FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
