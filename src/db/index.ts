import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Singleton client — reused across requests in the same serverless instance
const globalForDb = globalThis as unknown as { _pgClient?: ReturnType<typeof postgres> }

if (!globalForDb._pgClient) {
  globalForDb._pgClient = postgres(process.env.DATABASE_URL!, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 30,
    // Required when using Supabase's pgbouncer pooler in transaction mode
    prepare: false,
  })
}

const client = globalForDb._pgClient
export const db = drizzle(client, { schema })
