-- Phase 25 — covering index for per-resident booking aggregates.
-- Serves: residents page GROUP BY resident_id stats, due-for-visit's
-- window function (PARTITION BY resident_id ORDER BY start_time), and
-- peek-drawer last-visit lookups.
-- Additive + idempotent: safe to apply at any time, before or after deploy.
-- Apply: psql "$DIRECT_URL" -f drizzle/0027_bookings_resident_idx.sql
--   (or: npx dotenv -e .env.local -- npx drizzle-kit push)

CREATE INDEX IF NOT EXISTS bookings_facility_resident_start_idx
  ON bookings (facility_id, resident_id, start_time DESC);
