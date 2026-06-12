-- 2026-06-12: Custom feedback notification email for master admin profile
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS feedback_email text;
