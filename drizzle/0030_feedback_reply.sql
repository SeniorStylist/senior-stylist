-- P37 — two-way feedback replies (keep in sync with src/lib/feedback-ddl.ts)
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS reply text;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS replied_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS reply_read_at timestamptz;
