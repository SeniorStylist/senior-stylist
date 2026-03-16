import { defineConfig } from 'drizzle-kit'
import { config } from 'dotenv'

// drizzle-kit doesn't auto-load .env.local, so load it explicitly
config({ path: '.env.local' })

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
