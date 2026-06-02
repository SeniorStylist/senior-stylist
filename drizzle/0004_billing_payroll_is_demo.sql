-- Phase 13-Tutorial — is_demo on billing + payroll tables.
-- Lets the scripted billing/payroll/QuickBooks tutorials show populated demo
-- screens (a demo invoice, payment, pay period, and pay item) without those
-- records ever leaking into real billing, payroll, or analytics. Reads are
-- demo-symmetric: eq(table.is_demo, tutorialMode).
-- Idempotent: safe to re-run. Columns are also declared in src/db/schema.ts.
BEGIN;
ALTER TABLE qb_invoices       ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE qb_payments       ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pay_periods       ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE stylist_pay_items ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
COMMIT;
