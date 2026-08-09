-- P52 — family self-signup is ON by default everywhere (Josh, 2026-08-09):
-- every QR poster must work out of the box. The per-facility OFF switch in
-- Settings → Family Portal is unchanged.
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0035_p52_signup_everywhere.sql
-- (The master admin's "turn ON family signup everywhere" button performs the
-- same backfill from the UI — this migration makes it durable + flips the
-- column default for facilities created before the code deploy.)

ALTER TABLE facilities ALTER COLUMN portal_self_signup_enabled SET DEFAULT true;

UPDATE facilities
SET portal_self_signup_enabled = true
WHERE active = true AND portal_self_signup_enabled = false;

-- P52 — the family tapped "Yes — that's them" on the signup match card.
-- Also self-bootstrapped by src/lib/portal-claims-ddl.ts — keep in sync.
ALTER TABLE portal_claim_requests ADD COLUMN IF NOT EXISTS family_confirmed boolean;
