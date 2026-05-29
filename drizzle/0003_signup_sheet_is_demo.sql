-- Phase 13-Tutorial Batch 4 — is_demo on signup_sheet_entries.
-- Idempotent: safe to re-run. The column is also declared in src/db/schema.ts.
BEGIN;
ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
COMMIT;
