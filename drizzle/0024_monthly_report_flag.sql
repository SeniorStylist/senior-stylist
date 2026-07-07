-- Phase 16 G4 — auto-emailed monthly facility reports (opt-in per facility).
-- Idempotent; also self-bootstrapped by src/lib/monthly-report-ddl.ts (keep in sync).
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS monthly_report_enabled boolean NOT NULL DEFAULT false;
