-- P57 — facility codes are the family sign-up QR identity; uniqueness used to
-- be three separate app-level "active=true" checks with three different
-- regexes and NO constraint, so two concurrent creates (or a reactivation)
-- could both hold F240. Partial unique index on the upper-cased code among
-- ACTIVE facilities (inactive ones keep their old code — never reused).
--
-- RUN THIS PRE-CHECK FIRST; the index creation fails if it returns rows —
-- merge any duplicates via Master Admin → Merge before applying:
--   SELECT upper(facility_code) AS code, count(*)
--   FROM facilities
--   WHERE active = true AND facility_code IS NOT NULL
--   GROUP BY 1 HAVING count(*) > 1;
--
-- Idempotent; apply with: psql "$DIRECT_URL" -f drizzle/0043_facility_code_unique.sql

CREATE UNIQUE INDEX IF NOT EXISTS facilities_code_active_uniq
  ON facilities ((upper(facility_code)))
  WHERE active = true AND facility_code IS NOT NULL;
