-- P63 — facilities.timezone has NEVER had a migration.
--
-- The Drizzle schema declares `text('timezone').default('America/New_York').notNull()`,
-- but that is a type-level claim: no SQL has ever created or altered this column,
-- so the live constraint state is whatever the table was first created with. The
-- bulk importers (import-quickbooks, import-multi-log) insert facilities with no
-- timezone key at all and rely on a column default that may not exist.
--
-- A NULL here reaches Intl.DateTimeFormat inside a client component's useState
-- initializer and throws RangeError, taking the whole dashboard down with
-- "Something went wrong" — for imported communities only, which is why it looked
-- facility-specific.
--
-- Idempotent. Also applied automatically at runtime by
-- src/lib/facilities-ddl.ts::ensureFacilitiesSchema() — keep the two in sync.
--
-- Apply with: psql "$DIRECT_URL" -f drizzle/0049_facility_timezone.sql

-- See which rows are affected before running (optional):
--   SELECT id, facility_code, name, timezone FROM facilities
--   WHERE timezone IS NULL OR btrim(timezone) = '';

UPDATE facilities
SET timezone = 'America/New_York'
WHERE timezone IS NULL OR btrim(timezone) = '';

ALTER TABLE facilities ALTER COLUMN timezone SET DEFAULT 'America/New_York';
ALTER TABLE facilities ALTER COLUMN timezone SET NOT NULL;
