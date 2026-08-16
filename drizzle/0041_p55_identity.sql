-- P55 — email-OR-phone identity (owner decision: "the username will either be
-- the email or the phone number"). portal_accounts.email becomes nullable
-- (phone-only accounts); phone gains a digits-normalized unique index so one
-- phone = one account. portal_claim_requests.email becomes nullable too, and
-- gains password_hash — the wizard-collected password for MATCHED signups is
-- HELD on the claim and applied only after a verified entry (magic-link or
-- SMS-code), never on typed knowledge alone (anti-takeover rule).
--
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0041_p55_identity.sql
-- Also self-bootstrapped by src/lib/portal-identity-ddl.ts — keep in sync.

ALTER TABLE portal_accounts ALTER COLUMN email DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS portal_accounts_phone_digits_uniq
  ON portal_accounts ((regexp_replace(phone, '\D', '', 'g')))
  WHERE phone IS NOT NULL;

ALTER TABLE portal_claim_requests ALTER COLUMN email DROP NOT NULL;
ALTER TABLE portal_claim_requests ADD COLUMN IF NOT EXISTS password_hash text;
