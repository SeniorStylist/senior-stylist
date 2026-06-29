-- Services origin flag: distinguish the facility's real price-list catalog from
-- ad-hoc services bookkeepers create while logging. Idempotent.
-- Apply: psql "$DIRECT_URL" -f drizzle/0017_services_source.sql

ALTER TABLE services ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'price_list';

-- Backfill: services that match the exact shape the OCR daily-log importer creates
-- (price 0, no category, plain fixed pricing) were almost certainly bookkeeper-made.
-- Everything else stays 'price_list'. Admins can fix edge cases via the Promote action.
UPDATE services
SET source = 'ocr_import'
WHERE source = 'price_list'
  AND price_cents = 0
  AND category IS NULL
  AND pricing_type = 'fixed'
  AND addon_amount_cents IS NULL
  AND pricing_tiers IS NULL
  AND pricing_options IS NULL;

CREATE INDEX IF NOT EXISTS services_facility_source_idx ON services (facility_id, source) WHERE active = true;
