-- P54 — signup card tokens: a MATCHED signup (poaEmail / tier 1.5) gets no
-- portal session (the magic link stays the email verification), so the wizard's
-- payment step authorizes via a 30-minute single-use token instead. The token
-- is sha256-hashed at rest; it authorizes exactly SetupIntent create + card
-- save + autopay enable for one resident (authorizeResidentPayment via:'signup').
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0038_p54_signup_card_tokens.sql
-- Also self-bootstrapped by src/lib/signup-card-token.ts — keep in sync.

CREATE TABLE IF NOT EXISTS portal_signup_card_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  portal_account_id uuid REFERENCES portal_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_signup_card_tokens_hash_uniq
  ON portal_signup_card_tokens (token_hash);

ALTER TABLE portal_signup_card_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='portal_signup_card_tokens' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON portal_signup_card_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
