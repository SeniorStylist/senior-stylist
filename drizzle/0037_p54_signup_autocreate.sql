-- P54 — uniform account model (Josh, 2026-08-16): unsure signups now CREATE a
-- new resident immediately (status 'auto_created' on the claim row) instead of
-- a pending dead-end; the admin reviews keep-or-merge. This column stores the
-- near-miss best-match resident so the review card can offer one-tap merge.
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0037_p54_signup_autocreate.sql
-- Also self-bootstrapped by src/lib/portal-claims-ddl.ts — keep in sync.

ALTER TABLE portal_claim_requests
  ADD COLUMN IF NOT EXISTS merge_suggestion_resident_id uuid REFERENCES residents(id) ON DELETE SET NULL;
