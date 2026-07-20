-- P36 — family-editable care preferences (NEW table per the hot-table rule;
-- self-bootstrapped by src/lib/resident-prefs-ddl.ts — keep in sync).
CREATE TABLE IF NOT EXISTS resident_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resident_id uuid NOT NULL UNIQUE REFERENCES residents(id) ON DELETE CASCADE,
  style_notes text,
  allergy_notes text,
  preferred_stylist_id uuid REFERENCES stylists(id) ON DELETE SET NULL,
  visit_frequency text,
  email_reminders boolean NOT NULL DEFAULT true,
  sms_reminders boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE resident_preferences ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'resident_preferences' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON resident_preferences FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
