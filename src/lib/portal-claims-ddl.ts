import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

/**
 * P50 — self-bootstraps the signup-wizard claim columns (resident_name,
 * room_number, relationship) AND the P50-C7 portal_accounts.onboarded_at
 * column. Keep in sync with drizzle/0032_p50_claim_details.sql +
 * drizzle/0034_p50_portal_onboarded.sql.
 *
 * NOTE: 0034's one-time backfill (existing accounts marked onboarded) is
 * deliberately NOT here — a cold-start bootstrap weeks later would wrongly
 * mark brand-new accounts as onboarded. Apply 0034 via psql before deploy.
 *
 * Called at the top of: POST /api/portal/signup, GET /api/portal/claim-requests,
 * PATCH /api/portal/claim-requests/[id] (full-row read), and the C7 routes.
 */
export async function ensurePortalClaimsSchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  try {
    await db.execute(sql`ALTER TABLE portal_claim_requests ADD COLUMN IF NOT EXISTS resident_name text;`)
    await db.execute(sql`ALTER TABLE portal_claim_requests ADD COLUMN IF NOT EXISTS room_number text;`)
    await db.execute(sql`ALTER TABLE portal_claim_requests ADD COLUMN IF NOT EXISTS relationship text;`)
    await db.execute(sql`ALTER TABLE portal_accounts ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;`)
  } catch {
    _ensured = false
  }
}
