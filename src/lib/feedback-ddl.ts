// Self-bootstrapping DDL for feedback_submissions and profiles.feedback_email.
// The dev environment has no psql credentials, so the route applies idempotent
// DDL once per lambda instance. Keep in sync with drizzle/0005_feedback.sql,
// drizzle/0007_profiles_feedback_email.sql and drizzle/0010_feedback_meta.sql.

import { db } from '@/db'
import { sql } from 'drizzle-orm'

let ddlEnsured = false

export async function ensureFeedbackSchema(): Promise<void> {
  if (ddlEnsured) return
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS feedback_submissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
      user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
      role text,
      category text NOT NULL DEFAULT 'other',
      message text NOT NULL,
      page_path text,
      user_agent text,
      status text NOT NULL DEFAULT 'new',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`ALTER TABLE feedback_submissions ENABLE ROW LEVEL SECURITY`)
  await db.execute(sql`DROP POLICY IF EXISTS service_role_all ON feedback_submissions`)
  await db.execute(sql`CREATE POLICY "service_role_all" ON feedback_submissions FOR ALL TO service_role USING (true) WITH CHECK (true)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS feedback_submissions_status_created_idx ON feedback_submissions (status, created_at)`)
  await db.execute(sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS feedback_email text`)
  // 0010 — client context snapshot
  await db.execute(sql`ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS meta jsonb`)
  ddlEnsured = true
}
