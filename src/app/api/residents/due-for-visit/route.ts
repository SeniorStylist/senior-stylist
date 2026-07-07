// Phase 16 G2 — smart scheduling: residents who are DUE for a visit based on
// their own historical cadence. One SQL: lag() gaps over completed visits (last
// 18 months), median gap per resident (≥3 visits), due when the time since the
// last visit exceeds the median. Top 6 by overdue-ness.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { sql } from 'drizzle-orm'
import { getMostUsedServiceIds } from '@/lib/resident-service-usage'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId, role } = facilityUser
    if (!isAdminOrAbove(role) && !isFacilityStaff(role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Median inter-visit gap per resident over completed visits (18-month floor
    // bounds the window function), then residents whose last visit is older than
    // their own median. Postgres returns iterable rows directly (no .rows).
    const rows = (await db.execute(sql`
      WITH visits AS (
        SELECT
          b.resident_id,
          b.start_time,
          b.start_time - lag(b.start_time) OVER (PARTITION BY b.resident_id ORDER BY b.start_time) AS gap
        FROM bookings b
        WHERE b.facility_id = ${facilityId}
          AND b.status = 'completed'
          AND b.active = true
          AND b.is_demo = false
          AND b.start_time > now() - interval '18 months'
      ),
      cadence AS (
        SELECT
          resident_id,
          count(*) AS visit_count,
          max(start_time) AS last_visit,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) AS median_gap
        FROM visits
        GROUP BY resident_id
        HAVING count(*) >= 3 AND count(gap) >= 2
      )
      SELECT
        c.resident_id,
        r.name,
        r.room_number,
        c.last_visit,
        EXTRACT(EPOCH FROM c.median_gap)::bigint AS median_gap_seconds,
        EXTRACT(EPOCH FROM (now() - c.last_visit))::bigint AS since_last_seconds
      FROM cadence c
      JOIN residents r ON r.id = c.resident_id AND r.active = true AND r.is_demo = false
      WHERE now() - c.last_visit >= c.median_gap
        -- No point suggesting someone who already has a future booking
        AND NOT EXISTS (
          SELECT 1 FROM bookings nb
          WHERE nb.resident_id = c.resident_id
            AND nb.active = true
            AND nb.status IN ('scheduled', 'requested')
            AND nb.start_time > now()
        )
      ORDER BY (EXTRACT(EPOCH FROM (now() - c.last_visit)) / NULLIF(EXTRACT(EPOCH FROM c.median_gap), 0)) DESC
      LIMIT 6
    `)) as unknown as Array<{
      resident_id: string
      name: string
      room_number: string | null
      last_visit: string | Date
      median_gap_seconds: number | string
      since_last_seconds: number | string
    }>

    // Suggested service = each resident's most-used (one batched call)
    const mostUsed = await getMostUsedServiceIds(facilityId)

    const data = rows.map((r) => {
      const medianDays = Math.round(Number(r.median_gap_seconds) / 86400)
      const sinceDays = Math.round(Number(r.since_last_seconds) / 86400)
      return {
        residentId: r.resident_id,
        name: r.name,
        roomNumber: r.room_number,
        lastVisit: new Date(r.last_visit).toISOString(),
        usualCadenceDays: medianDays,
        daysSinceLastVisit: sinceDays,
        suggestedServiceId: mostUsed.get(r.resident_id) ?? null,
      }
    })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/residents/due-for-visit error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
