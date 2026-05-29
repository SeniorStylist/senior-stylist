-- Phase 13-Tutorial Batch 2: add is_demo to facilities
-- Idempotent — safe to run multiple times.
-- Apply via: psql "$DIRECT_URL" -f drizzle/0002_facilities_is_demo.sql
BEGIN;
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS facilities_demo_idx ON facilities (id) WHERE is_demo = TRUE;
COMMIT;
