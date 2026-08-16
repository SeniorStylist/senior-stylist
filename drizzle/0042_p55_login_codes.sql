-- P55 — SMS-code login (dormant until TWILIO_ENABLED='true' + a from-number).
-- 6-digit codes, sha256-hashed, 10-minute expiry, ≤5 attempts, single-use.
-- Verifying a code is a VERIFIED entry: it mints a portal session AND
-- activates any held signup password (the anti-takeover rule's phone channel).
--
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0042_p55_login_codes.sql
-- Also self-bootstrapped by src/lib/portal-identity-ddl.ts — keep in sync.

CREATE TABLE IF NOT EXISTS portal_login_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_account_id uuid NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE portal_login_codes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='portal_login_codes' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON portal_login_codes FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
