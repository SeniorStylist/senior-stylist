-- Phase 15 F4 — cancellation waitlist.
-- Idempotent; also self-bootstrapped by src/lib/waitlist-ddl.ts (keep in sync).
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES facilities(id),
  resident_id uuid REFERENCES residents(id),
  resident_name text NOT NULL,
  room_number text,
  service_id uuid REFERENCES services(id),
  service_name text,
  preferred_stylist_id uuid REFERENCES stylists(id),
  earliest_date date NOT NULL,
  latest_date date,
  notes text,
  created_by uuid NOT NULL REFERENCES profiles(id),
  status text NOT NULL DEFAULT 'pending',
  booking_id uuid REFERENCES bookings(id),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waitlist_facility_pending_idx ON waitlist_entries (facility_id, earliest_date) WHERE status = 'pending';
ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='waitlist_entries' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON waitlist_entries FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
