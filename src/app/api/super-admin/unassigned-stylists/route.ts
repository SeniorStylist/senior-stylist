// P61 — the orphan finder.
//
// A stylist created without a facility gets no home row AND no
// stylist_facility_assignments row. Every roster in the app reads
// home-row-OR-active-assignment, so such a stylist is invisible on /stylists,
// the Day Log picker, the booking modal and the Master Admin per-facility
// count — the only surface that shows her at all is the command palette.
// That is how Tatyana ST833 disappeared after being "added" successfully.
//
// This route is the one place that lists them, so the owner can put them
// somewhere. Repair goes through POST /api/facilities/[facilityId]/stylists,
// which already upserts the assignment, backfills stylists.facility_id where
// it is NULL, and can seed availability at the facility's hours.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { isMasterEmail } from '@/lib/get-facility-id'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isMasterEmail(user.email)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    // ONE query — a per-stylist existence check would serialize through the
    // max:1 pool. Catches both shapes: no home facility at all, and a home
    // facility that has since been deactivated.
    const rows = await db.execute(sql`
      SELECT s.id, s.name, s.stylist_code, s.color, s.created_at
      FROM stylists s
      WHERE s.active = true
        AND s.is_demo = false
        AND NOT EXISTS (
          SELECT 1 FROM stylist_facility_assignments a
          WHERE a.stylist_id = s.id AND a.active = true
        )
        AND (
          s.facility_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM facilities f WHERE f.id = s.facility_id AND f.active = true
          )
        )
      ORDER BY s.created_at DESC NULLS LAST
      LIMIT 100
    `)

    // The postgres driver returns rows directly — there is no .rows wrapper.
    const list = (rows as unknown as Array<{
      id: string
      name: string
      stylist_code: string | null
      color: string | null
    }>).map((r) => ({
      id: r.id,
      name: r.name,
      stylistCode: r.stylist_code ?? null,
      color: r.color ?? null,
    }))

    return Response.json({ data: { stylists: list } })
  } catch (err) {
    console.error('GET /api/super-admin/unassigned-stylists error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
