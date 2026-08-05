-- P50-C7 — first-login welcome flow flag.
-- Apply with: psql "$DIRECT_URL" -f drizzle/0034_p50_portal_onboarded.sql
-- Idempotent. The COLUMN is also self-bootstrapped by
-- src/lib/portal-claims-ddl.ts::ensurePortalClaimsSchema(); the BACKFILL below
-- is deliberately migration-only (a cold-start bootstrap weeks later would
-- wrongly mark brand-new accounts as onboarded) — apply this BEFORE deploy.

ALTER TABLE portal_accounts ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- One-time backfill: every pre-P50 account has already been using the portal —
-- they must never see the first-login setup flow.
UPDATE portal_accounts SET onboarded_at = now() WHERE onboarded_at IS NULL;
