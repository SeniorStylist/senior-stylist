-- P50 — the signup wizard finally asks WHO the resident is. Before this, the
-- form collected only the POA's own details and the admin had to guess which
-- resident a claim belonged to from a full facility dropdown.
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0032_p50_claim_details.sql
-- (also self-bootstrapped by src/lib/portal-claims-ddl.ts — keep in sync)

ALTER TABLE portal_claim_requests ADD COLUMN IF NOT EXISTS resident_name text;
ALTER TABLE portal_claim_requests ADD COLUMN IF NOT EXISTS room_number text;
ALTER TABLE portal_claim_requests ADD COLUMN IF NOT EXISTS relationship text;
