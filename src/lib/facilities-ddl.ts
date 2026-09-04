import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

/**
 * Self-heals the `facilities` columns that ship ahead of their migration.
 *
 * P62 renamed this from `ensureMonthlyReportSchema` and folded the timezone
 * repair in, deliberately as ONE call with two statements: this runs on the
 * protected layout's critical path, first in line on the single pooled
 * connection, so a second DDL round-trip here would make the very contention we
 * are fixing worse.
 *
 * Kept in sync with drizzle/0024_monthly_report_flag.sql and
 * drizzle/0049_facility_timezone.sql.
 */
export async function ensureFacilitiesSchema(): Promise<void> {
  if (_ensured) return
  // P62 — set BEFORE the await and never un-set on failure. The old version
  // reset the flag inside .catch(), so a failing instance retried an ACCESS
  // EXCLUSIVE lock on `facilities` on EVERY render — worst under exactly the
  // contention that makes it fail. These statements are idempotent and the
  // migration is applied in production; one attempt per instance is the point.
  _ensured = true
  try {
    await db.execute(sql`
      ALTER TABLE facilities ADD COLUMN IF NOT EXISTS monthly_report_enabled boolean NOT NULL DEFAULT false;
    `)
    // The timezone column has NEVER had a migration — the Drizzle schema claims
    // NOT NULL DEFAULT but that is a type-level claim only, and the bulk
    // importers insert facilities with no timezone key at all. A NULL here threw
    // a RangeError out of Intl.DateTimeFormat and took the dashboard down.
    await db.execute(sql`
      UPDATE facilities SET timezone = 'America/New_York'
      WHERE timezone IS NULL OR btrim(timezone) = '';
    `)
    await db.execute(sql`
      ALTER TABLE facilities ALTER COLUMN timezone SET DEFAULT 'America/New_York';
    `)
    await db.execute(sql`
      ALTER TABLE facilities ALTER COLUMN timezone SET NOT NULL;
    `)
  } catch (err) {
    console.error('[facilities-ddl] self-heal failed (continuing):', err)
  }
}
