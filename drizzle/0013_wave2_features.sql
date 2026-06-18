-- Wave 2 schema additions for: changelog widget (13A), service reorder (13J),
-- resident photos (13G), daily digest (13E)
-- Idempotent — safe to run multiple times.

-- 13A: per-user changelog read timestamp
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS changelog_last_read_at timestamptz;

-- 13J: service display order within a category
ALTER TABLE services ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- 13G: resident photo upload path (Supabase Storage private bucket)
ALTER TABLE residents ADD COLUMN IF NOT EXISTS photo_path text;

-- 13E: per-facility daily digest opt-in (master ops digest always on separately)
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS daily_digest_enabled boolean NOT NULL DEFAULT false;
