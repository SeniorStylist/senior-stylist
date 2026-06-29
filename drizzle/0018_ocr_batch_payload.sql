-- OCR daily-log scans: store the confirmed review sheets so an "Undo & edit" can
-- reopen the scan review pre-filled (change facility/stylist, re-import). Idempotent.
-- Apply: psql "$DIRECT_URL" -f drizzle/0018_ocr_batch_payload.sql

ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS review_payload jsonb;
