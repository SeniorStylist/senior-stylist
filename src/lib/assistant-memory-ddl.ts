import { db } from '@/db'
import { sql } from 'drizzle-orm'

let _ensured = false

/** P44 — self-bootstraps assistant_memories. Keep in sync with drizzle/0031_assistant_memories.sql. */
export async function ensureAssistantMemorySchema(): Promise<void> {
  if (_ensured) return
  _ensured = true
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS assistant_memories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
        scope text NOT NULL DEFAULT 'user',
        facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
        role text,
        content text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        source text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS assistant_memories_user_active_idx
        ON assistant_memories (user_id) WHERE scope = 'user' AND status = 'active';
    `)
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS assistant_memories_proposed_idx
        ON assistant_memories (status) WHERE status = 'proposed';
    `)
    await db.execute(sql`ALTER TABLE assistant_memories ENABLE ROW LEVEL SECURITY;`)
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='assistant_memories' AND policyname='service_role_all') THEN
          CREATE POLICY "service_role_all" ON assistant_memories FOR ALL TO service_role USING (true) WITH CHECK (true);
        END IF;
      END $$;
    `)
  } catch {
    _ensured = false
  }
}
