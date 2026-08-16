import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

/**
 * P55 — self-bootstraps the email-OR-phone identity columns. Keep in sync with
 * drizzle/0041_p55_identity.sql (and 0042 for the SMS login-code table).
 *
 * Called at the top of: POST /api/portal/signup, POST /api/portal/login, the
 * magic-link verify page path (via portal-auth), and the SMS-code routes — so
 * a pre-migration deploy can't break sign-in or signup.
 */
export async function ensurePortalIdentitySchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  try {
    await db.execute(sql`ALTER TABLE portal_accounts ALTER COLUMN email DROP NOT NULL;`)
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS portal_accounts_phone_digits_uniq
        ON portal_accounts ((regexp_replace(phone, '\\D', '', 'g')))
        WHERE phone IS NOT NULL;
    `)
    await db.execute(sql`ALTER TABLE portal_claim_requests ALTER COLUMN email DROP NOT NULL;`)
    await db.execute(sql`ALTER TABLE portal_claim_requests ADD COLUMN IF NOT EXISTS password_hash text;`)
    // 0042 — SMS-code login (dormant until Twilio; table must exist either way)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS portal_login_codes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        portal_account_id uuid NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
        code_hash text NOT NULL,
        expires_at timestamptz NOT NULL,
        attempts integer NOT NULL DEFAULT 0,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `)
    await db.execute(sql`ALTER TABLE portal_login_codes ENABLE ROW LEVEL SECURITY;`)
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='portal_login_codes' AND policyname='service_role_all') THEN
          CREATE POLICY "service_role_all" ON portal_login_codes FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `)
  } catch {
    _ensured = false
  }
}
