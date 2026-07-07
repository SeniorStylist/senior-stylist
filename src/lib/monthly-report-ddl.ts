import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

export async function ensureMonthlyReportSchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  // Idempotent — kept in sync with drizzle/0024_monthly_report_flag.sql
  await db.execute(sql`
    ALTER TABLE facilities ADD COLUMN IF NOT EXISTS monthly_report_enabled boolean NOT NULL DEFAULT false;
  `).catch(() => { _ensured = false })
}
