// Self-bootstrapping DDL for invite delivery/engagement tracking columns.
// The dev environment has no psql credentials, so any route/page that queries
// the invites table applies idempotent DDL once per lambda instance. Without
// this, adding the columns to schema.ts would break every invites query until
// the migration ran (Drizzle SELECTs all declared columns). Keep in sync with
// drizzle/0011_invite_tracking.sql.

import { db } from '@/db'
import { sql } from 'drizzle-orm'

let ddlEnsured = false

export async function ensureInviteTrackingSchema(): Promise<void> {
  if (ddlEnsured) return
  try {
    await db.execute(sql`
      ALTER TABLE invites
        ADD COLUMN IF NOT EXISTS last_sent_at timestamp,
        ADD COLUMN IF NOT EXISTS email_failed boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS viewed_at timestamp,
        ADD COLUMN IF NOT EXISTS accepted_at timestamp
    `)
    ddlEnsured = true
  } catch (err) {
    console.error('[ensureInviteTrackingSchema] failed:', err)
  }
}
