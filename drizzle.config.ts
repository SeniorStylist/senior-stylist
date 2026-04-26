import { defineConfig } from 'drizzle-kit'
import { config } from 'dotenv'

// drizzle-kit doesn't auto-load .env.local, so load it explicitly
config({ path: '.env.local' })

// Migrations (drizzle-kit push/migrate) prefer DIRECT_URL when set — bypasses pgBouncer.
// Runtime queries in src/db/index.ts continue to use the pooled DATABASE_URL.
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
})
