-- P55 — data heal: real sign-up-sheet entries that were auto-assigned to a
-- DEMO stylist (resolveAssignedStylist had no is_demo filter, so seeded
-- "Demo Sarah" won both the day-of-week and fallback paths). Such entries were
-- invisible to every real stylist (the queue filters own + unassigned).
-- Un-assigning them makes them visible to everyone again; auto-assignment is
-- fixed in code alongside this migration.
--
-- Idempotent + re-runnable; apply with:
--   psql "$DIRECT_URL" -f drizzle/0040_p55_demo_assignment_heal.sql
-- Deliberately MIGRATION-ONLY (no ensure*() bootstrap) — data heals must not
-- re-run on cold starts weeks later (P53 backfill doctrine).

UPDATE signup_sheet_entries
SET assigned_to_stylist_id = NULL
WHERE is_demo = false
  AND assigned_to_stylist_id IN (SELECT id FROM stylists WHERE is_demo = true);
