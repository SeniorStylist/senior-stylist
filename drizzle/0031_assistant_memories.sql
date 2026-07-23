-- P44 — per-user AI assistant memory + owner-approved shared learnings.
-- Idempotent; also self-bootstrapped by src/lib/assistant-memory-ddl.ts
-- (keep both in sync). Apply: psql "$DIRECT_URL" -f drizzle/0031_assistant_memories.sql

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

CREATE INDEX IF NOT EXISTS assistant_memories_user_active_idx
  ON assistant_memories (user_id) WHERE scope = 'user' AND status = 'active';
CREATE INDEX IF NOT EXISTS assistant_memories_proposed_idx
  ON assistant_memories (status) WHERE status = 'proposed';

ALTER TABLE assistant_memories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='assistant_memories' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON assistant_memories FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
