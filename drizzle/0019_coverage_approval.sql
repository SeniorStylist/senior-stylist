-- 13F: time-off approval workflow — coverage requests now start 'pending' and an
-- admin approves (→ 'open') or denies (→ 'denied') before the substitute search.
-- Existing rows are untouched ('open' = already approved). Idempotent.
-- Apply: psql "$DIRECT_URL" -f drizzle/0019_coverage_approval.sql

ALTER TABLE coverage_requests ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES profiles(id);
ALTER TABLE coverage_requests ADD COLUMN IF NOT EXISTS approved_at timestamp;
ALTER TABLE coverage_requests ADD COLUMN IF NOT EXISTS denied_reason text;
