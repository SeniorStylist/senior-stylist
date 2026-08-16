// P54 — signup card tokens. A MATCHED family signup (poaEmail / tier 1.5) gets
// NO portal session — the magic-link email stays the identity verification —
// but the wizard's payment step still needs to vault a card for that resident.
// This token is the bridge: 30 minutes, single-use (consumed on card-save
// success so a SetupIntent retry inside the window still works), sha256-hashed
// at rest, scoped to exactly one resident. authorizeResidentPayment's
// via:'signup' branch verifies it; only setup-intent + methods POST accept it.

import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '@/db'
import { portalSignupCardTokens } from '@/db/schema'
import { sql } from 'drizzle-orm'

const TOKEN_TTL_MS = 30 * 60 * 1000

let _ensured = false

/** Keep in sync with drizzle/0038_p54_signup_card_tokens.sql. */
export async function ensureSignupCardTokenSchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  try {
    await db.execute(sql`
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
    `)
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS portal_signup_card_tokens_hash_uniq
        ON portal_signup_card_tokens (token_hash);
    `)
    await db.execute(sql`ALTER TABLE portal_signup_card_tokens ENABLE ROW LEVEL SECURITY;`)
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='portal_signup_card_tokens' AND policyname='service_role_all') THEN
          CREATE POLICY "service_role_all" ON portal_signup_card_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `)
  } catch {
    _ensured = false
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Mint a token for the signup payment step. Returns the PLAINTEXT (never stored). */
export async function mintSignupCardToken(opts: {
  residentId: string
  facilityId: string
  portalAccountId: string | null
}): Promise<string> {
  await ensureSignupCardTokenSchema()
  const token = randomBytes(24).toString('base64url')
  await db.insert(portalSignupCardTokens).values({
    tokenHash: hashToken(token),
    residentId: opts.residentId,
    facilityId: opts.facilityId,
    portalAccountId: opts.portalAccountId,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  })
  return token
}

/**
 * Verify a plaintext token against a specific resident: unexpired, unconsumed,
 * and minted FOR that resident (a token can never authorize a different one).
 */
export async function verifySignupCardToken(
  token: string,
  residentId: string,
): Promise<{ ok: true; tokenId: string; portalAccountId: string | null } | { ok: false }> {
  if (!token || token.length > 200) return { ok: false }
  await ensureSignupCardTokenSchema()
  const row = await db.query.portalSignupCardTokens.findFirst({
    where: and(
      eq(portalSignupCardTokens.tokenHash, hashToken(token)),
      eq(portalSignupCardTokens.residentId, residentId),
      isNull(portalSignupCardTokens.usedAt),
      gt(portalSignupCardTokens.expiresAt, new Date()),
    ),
    columns: { id: true, portalAccountId: true },
  })
  if (!row) return { ok: false }
  return { ok: true, tokenId: row.id, portalAccountId: row.portalAccountId }
}

/**
 * Consume on card-save SUCCESS (methods POST) — not on setup-intent create, so
 * a declined first card can be retried inside the 30-minute window.
 */
export async function consumeSignupCardToken(token: string): Promise<void> {
  try {
    await db
      .update(portalSignupCardTokens)
      .set({ usedAt: new Date() })
      .where(eq(portalSignupCardTokens.tokenHash, hashToken(token)))
  } catch {
    // Best-effort: a consume failure leaves a 30-min window, not a breach.
  }
}
