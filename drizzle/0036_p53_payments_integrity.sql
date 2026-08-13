-- P53 — payments integrity (2026-08-13). Idempotent; apply with:
--   psql "$DIRECT_URL" -f drizzle/0036_p53_payments_integrity.sql

-- (1) Credit-banking idempotency: Stripe delivers checkout.session.completed
-- at-least-once; the old read-then-write LIKE scan could bank a prepay/gift
-- credit twice. Insert-first + this partial unique index closes the race.
-- Also self-bootstrapped by src/lib/unapplied-ddl.ts — keep in sync.
ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;
CREATE UNIQUE INDEX IF NOT EXISTS qb_unapplied_credits_stripe_pi_unique
  ON qb_unapplied_credits (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- (2) Backfill (migration-only, per repo convention — the DDL bootstrap never
-- runs backfills): residents created by claim approval before P53 got no
-- portal_token, which silently skipped their POA booking-confirmation emails.
UPDATE residents
SET portal_token = substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 16)
WHERE portal_token IS NULL;
