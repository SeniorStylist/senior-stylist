// P63 — the last N server render errors, with the facility each happened at.
//
// This is the other half of the error card: the card shows Next's digest, this
// says what the digest means. Master-gated; prunes to 14 days on read so the
// error path itself stays a single INSERT.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { isMasterEmail } from '@/lib/get-facility-id'
import { ensureErrorEventsSchema } from '@/lib/error-events-ddl'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isMasterEmail(user.email)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    await ensureErrorEventsSchema()

    // Pruning here rather than on insert keeps the failure path a single write.
    await db.execute(sql`DELETE FROM app_error_events WHERE created_at < now() - interval '14 days'`)
      .catch(() => {})

    const rows = await db.execute(sql`
      SELECT e.id, e.digest, e.message, e.path, e.created_at,
             f.name AS facility_name, f.facility_code
      FROM app_error_events e
      LEFT JOIN facilities f ON f.id = e.facility_id
      ORDER BY e.created_at DESC
      LIMIT 25
    `)

    // The postgres driver returns rows directly — no .rows wrapper.
    const list = (rows as unknown as Array<{
      id: string
      digest: string | null
      message: string | null
      path: string | null
      created_at: string | Date
      facility_name: string | null
      facility_code: string | null
    }>).map((r) => ({
      id: r.id,
      digest: r.digest,
      message: r.message,
      path: r.path,
      at: typeof r.created_at === 'string' ? r.created_at : r.created_at?.toISOString?.() ?? null,
      facility: r.facility_name
        ? `${r.facility_code ? r.facility_code + ' ' : ''}${r.facility_name}`
        : null,
    }))

    return Response.json({ data: { errors: list } })
  } catch (err) {
    console.error('GET /api/debug/errors error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
