import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

/**
 * P50 — self-bootstraps the sign-up-sheet columns that let family-portal
 * requests land in the queue. Keep in sync with drizzle/0033_p50_signup_source.sql
 * + drizzle/0039_p54_signup_multiservice.sql.
 *
 * Called at the top of EVERY signup-sheet route (GET does a full-row findMany,
 * so a pre-migration deploy would break the queue + badge without this) and
 * the portal request writer.
 */
export async function ensureSignupSheetSchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  try {
    await db.execute(sql`ALTER TABLE signup_sheet_entries ALTER COLUMN created_by DROP NOT NULL;`)
    await db.execute(sql`ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff';`)
    await db.execute(sql`ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS created_by_portal_account_id uuid REFERENCES portal_accounts(id) ON DELETE SET NULL;`)
    await db.execute(sql`ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS preferred_date_to date;`)
    // 0039 — P54 multi-service (service_ids includes the primary; names denormalized)
    await db.execute(sql`ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS service_ids jsonb;`)
    await db.execute(sql`ALTER TABLE signup_sheet_entries ADD COLUMN IF NOT EXISTS service_names jsonb;`)
  } catch {
    _ensured = false
  }
}
