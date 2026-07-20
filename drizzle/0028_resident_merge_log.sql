-- P36 — audit row per resident duplicate-merge. Idempotent; also
-- self-bootstrapped by src/lib/resident-merge-ddl.ts (keep in sync).
CREATE TABLE IF NOT EXISTS resident_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  performed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
  keep_resident_id uuid,
  merged_resident_id uuid,
  merged_resident_name text NOT NULL,
  moved jsonb NOT NULL DEFAULT '{}'::jsonb,
  fields_inherited text[] NOT NULL DEFAULT '{}'::text[],
  cards_left_behind integer NOT NULL DEFAULT 0,
  notes text
);

ALTER TABLE resident_merge_log ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'resident_merge_log' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY "service_role_all" ON resident_merge_log FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
