import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Singleton client — reused across requests in the same serverless instance
const globalForDb = globalThis as unknown as { _pgClient?: ReturnType<typeof postgres> }

if (!globalForDb._pgClient) {
  // DATABASE_URL points at Supabase's session-mode pooler (port 5432).
  // Session mode supports prepared statements, so prepare:false is not needed.
  globalForDb._pgClient = postgres(process.env.DATABASE_URL!, {
    max: 1,
    connect_timeout: 10,
  })
}

const client = globalForDb._pgClient
export const db = drizzle(client, { schema })
