-- P57 — an invite now records WHICH stylist directory record it was sent for.
-- Before this, redemption re-derived the stylist by email and then by fuzzy
-- name: two stylists with similar names could link to each other's records,
-- and a stylist who accepted at a different address than the one on file
-- linked to nothing and landed view-only. Nullable — only the stylist-invite
-- route sets it; team invites leave it null and keep the old heuristic.
--
-- ON DELETE SET NULL: stylists are soft-deleted (active=false), but a hard
-- delete must never orphan the invite row.
--
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0044_p57_invite_stylist.sql
-- (also self-bootstrapped at runtime by src/lib/invite-ddl.ts — keep in sync)

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS stylist_id uuid REFERENCES stylists(id) ON DELETE SET NULL;
