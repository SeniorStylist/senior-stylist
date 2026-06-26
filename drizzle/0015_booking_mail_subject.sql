-- Per-log-sheet "Mail Subject" for the daily-log Excel export (column B).
-- Entered at OCR-scan time per sheet; export-modal subject is the fallback.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mail_subject text;
