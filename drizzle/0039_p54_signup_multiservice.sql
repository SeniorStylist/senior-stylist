-- P54 — real multi-service sign-up-sheet entries (owner decision, Fitzgerald
-- meeting). service_ids INCLUDES the primary (mirrors bookings.serviceIds);
-- service_names is the denormalized display copy (mirrors bookings.serviceNames).
-- serviceId/serviceName stay = the FIRST service so every existing reader is
-- untouched; null arrays fall back to [serviceId].
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0039_p54_signup_multiservice.sql
-- Also self-bootstrapped by src/lib/signup-sheet-ddl.ts — keep in sync.

ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS service_ids jsonb;
ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS service_names jsonb;
