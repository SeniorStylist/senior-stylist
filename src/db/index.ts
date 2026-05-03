import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Singleton client — reused across requests in the same serverless instance
const globalForDb = globalThis as unknown as { _pgClient?: ReturnType<typeof postgres> }

if (!globalForDb._pgClient) {
  globalForDb._pgClient = postgres(process.env.DATABASE_URL!, {
    max: 1,
    connect_timeout: 10,
    // Required when DATABASE_URL points at Supabase's transaction-mode pooler
    // (port 6543). Safe to keep on the session-mode pooler (port 5432) too.
    prepare: false,
  })
}

const client = globalForDb._pgClient
export const db = drizzle(client, { schema })
