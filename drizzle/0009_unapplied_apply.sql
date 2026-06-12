-- Site-side application of unapplied QB credits (2026-06-12).
-- Idempotent — apply with: psql "$DIRECT_URL" -f drizzle/0009_unapplied_apply.sql
-- (Also self-bootstrapped by src/lib/unapplied-ddl.ts — keep the two in sync.)

ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_cents integer NOT NULL DEFAULT 0;
ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_at timestamptz;
ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_by uuid;
ALTER TABLE qb_unapplied_credits ADD COLUMN IF NOT EXISTS applied_detail jsonb;
