-- P50 — family-portal appointment requests now land in the sign-up-sheet
-- queue (the mature stylist-fits-you-in pipeline) instead of creating ghost
-- 'requested' bookings on the calendar. created_by loses NOT NULL because
-- portal users live in portal_accounts, not profiles.
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0033_p50_signup_source.sql
-- (also self-bootstrapped by src/lib/signup-sheet-ddl.ts — keep in sync)

ALTER TABLE signup_sheet_entries ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff';
ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS created_by_portal_account_id uuid REFERENCES portal_accounts(id) ON DELETE SET NULL;
ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS preferred_date_to date;
