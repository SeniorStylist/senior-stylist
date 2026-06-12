-- QB invoice numbers are "MMDD Lastname" — the same number recurs across years
-- (e.g. "1026 Means" in 2022 AND 2023). The old (invoice_num, facility_id) unique
-- key silently merged those distinct invoices on import. Adding invoice_date to the
-- key keeps re-imports idempotent while letting different-date invoices coexist.
-- Idempotent — apply with: psql "$DIRECT_URL" -f drizzle/0006_qb_invoices_dedup_date.sql
DROP INDEX IF EXISTS qb_invoices_dedup_idx;
CREATE UNIQUE INDEX IF NOT EXISTS qb_invoices_dedup_idx
  ON qb_invoices (invoice_num, facility_id, invoice_date);
