import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

export async function ensureResidentPhotosSchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  // Idempotent — kept in sync with drizzle/0025_resident_photos.sql
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS resident_photos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      facility_id uuid NOT NULL REFERENCES facilities(id),
      resident_id uuid NOT NULL REFERENCES residents(id) ON DELETE CASCADE,
      booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
      path text NOT NULL,
      caption text,
      shared_with_family boolean NOT NULL DEFAULT false,
      created_by uuid,
      is_demo boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS resident_photos_resident_created_idx ON resident_photos (resident_id, created_at DESC);
    ALTER TABLE resident_photos ENABLE ROW LEVEL SECURITY;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='resident_photos' AND policyname='service_role_all') THEN
        CREATE POLICY "service_role_all" ON resident_photos FOR ALL TO service_role USING (true) WITH CHECK (true);
      END IF;
    END $$;
  `).catch(() => { _ensured = false })
}
