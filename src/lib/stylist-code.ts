import { sql } from 'drizzle-orm'
import { stylists } from '@/db/schema'
import type { db } from '@/db'

type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Generates the next stylist code (ST001, ST002, …).
 * Must be called inside a db.transaction() — takes an advisory lock that
 * serializes concurrent code generation within the transaction scope.
 */
export async function generateStylistCode(tx: DrizzleTx): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(9191)`)

  const rows = await tx
    .select({ code: stylists.stylistCode })
    .from(stylists)
    .where(sql`${stylists.stylistCode} ~ '^ST[0-9]+$'`)

  let max = 0
  for (const r of rows) {
    const n = parseInt(r.code.slice(2), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  const next = max + 1
  return `ST${String(next).padStart(3, '0')}`
}
