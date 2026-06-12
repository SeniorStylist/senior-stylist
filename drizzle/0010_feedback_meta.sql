-- Client context snapshot on feedback submissions (viewport, screen, dpr,
-- timezone, language, standalone/PWA, online). Idempotent — apply with:
--   psql "$DIRECT_URL" -f drizzle/0010_feedback_meta.sql
-- Also self-bootstrapped by src/lib/feedback-ddl.ts (keep in sync).

ALTER TABLE feedback_submissions ADD COLUMN IF NOT EXISTS meta jsonb;
