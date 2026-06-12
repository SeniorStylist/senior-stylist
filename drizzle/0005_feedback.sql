-- Feedback widget (2026-06-11) — idempotent. Apply with:
--   psql "$DIRECT_URL" -f drizzle/0005_feedback.sql

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
);

CREATE INDEX IF NOT EXISTS feedback_submissions_status_created_idx
  ON feedback_submissions (status, created_at);

ALTER TABLE feedback_submissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'feedback_submissions' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON feedback_submissions
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
