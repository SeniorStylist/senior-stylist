-- Invite delivery + engagement tracking. Idempotent.
-- Apply with: psql "$DIRECT_URL" -f drizzle/0011_invite_tracking.sql
-- (also self-bootstrapped at runtime by src/lib/invite-ddl.ts)

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS last_sent_at timestamp,
  ADD COLUMN IF NOT EXISTS email_failed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS viewed_at timestamp,
  ADD COLUMN IF NOT EXISTS accepted_at timestamp;
