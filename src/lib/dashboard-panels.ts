// Phase 25 — shared server-side queries for the dashboard's right-panel data.
// One home for the logic so GET /api/dashboard/panels (the consolidated
// dashboard-mount fetch) and the standalone routes (/api/stats, /api/waitlist,
// /api/residents/due-for-visit — kept for post-mutation refetches) stay in
// exact sync. Server-only: imports the db.

import { db } from '@/db'
import { facilities, waitlistEntries } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { ensureWaitlistSchema } from '@/lib/waitlist-ddl'
import { getMostUsedServiceIds } from '@/lib/resident-service-usage'
import { dayRangeInTimezone, getLocalParts } from '@/lib/time'

export interface FacilityStats {
  today: { count: number; revenueCents: number }
  thisWeek: { count: number; revenueCents: number }
  thisMonth: { count: number; revenueCents: number }
}

/**
 * Today / this-week / this-month booking counts + revenue in ONE aggregate
 * query. The week can straddle the month boundary in both directions, so the
 * outer scan covers the union of the two ranges and each bucket filters its own.
 * price_cents only — never add tip_cents (tips go to stylist, not facility revenue)
 */
export async function getFacilityStats(facilityId: string, tutorialMode: boolean): Promise<FacilityStats> {
  const now = new Date()

  // P32 — today/week/month windows are the FACILITY's calendar (was UTC,
  // which flipped "today" at 8pm ET and mis-bucketed evening bookings).
  const tzRow = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { timezone: true },
  })
  const tz = tzRow?.timezone ?? 'America/New_York'
  const p = getLocalParts(now, tz)
  const localDateStr = (y: number, m: number, d: number) => {
    // normalize via Date.UTC so month/day overflow rolls over correctly
    const dt = new Date(Date.UTC(y, m - 1, d))
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
  }
  const todayStr = localDateStr(p.year, p.month, p.day)

  const todayRange = dayRangeInTimezone(todayStr, tz)
  const todayStart = todayRange?.start ?? new Date(Date.UTC(p.year, p.month - 1, p.day))
  const todayEnd = todayRange?.end ?? new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const daysFromMon = ((dowMap[p.weekday] ?? 0) + 6) % 7
  const weekStartStr = localDateStr(p.year, p.month, p.day - daysFromMon)
  const weekEndStr = localDateStr(p.year, p.month, p.day - daysFromMon + 7)
  const weekStart = dayRangeInTimezone(weekStartStr, tz)?.start ?? todayStart
  const weekEnd = dayRangeInTimezone(weekEndStr, tz)?.start ?? todayEnd

  const monthStart = dayRangeInTimezone(localDateStr(p.year, p.month, 1), tz)?.start ?? todayStart
  const monthEnd = dayRangeInTimezone(localDateStr(p.year, p.month + 1, 1), tz)?.start ?? todayEnd

  const rangeStart = weekStart < monthStart ? weekStart : monthStart
  const rangeEnd = weekEnd > monthEnd ? weekEnd : monthEnd

  // Counts = booked workload (non-cancelled/non-no_show, as before).
  // Revenue SUMs = revenue earned = completed only — scheduled/requested are
  // booked, not earned (P32 — a scheduled/cancelled booking must never show
  // as money in the dashboard tiles).
  const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE b.start_time >= ${todayStart.toISOString()}::timestamptz AND b.start_time < ${todayEnd.toISOString()}::timestamptz) AS today_count,
      COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)) FILTER (WHERE b.status = 'completed' AND b.start_time >= ${todayStart.toISOString()}::timestamptz AND b.start_time < ${todayEnd.toISOString()}::timestamptz), 0) AS today_cents,
      COUNT(*) FILTER (WHERE b.start_time >= ${weekStart.toISOString()}::timestamptz AND b.start_time < ${weekEnd.toISOString()}::timestamptz) AS week_count,
      COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)) FILTER (WHERE b.status = 'completed' AND b.start_time >= ${weekStart.toISOString()}::timestamptz AND b.start_time < ${weekEnd.toISOString()}::timestamptz), 0) AS week_cents,
      COUNT(*) FILTER (WHERE b.start_time >= ${monthStart.toISOString()}::timestamptz AND b.start_time < ${monthEnd.toISOString()}::timestamptz) AS month_count,
      COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)) FILTER (WHERE b.status = 'completed' AND b.start_time >= ${monthStart.toISOString()}::timestamptz AND b.start_time < ${monthEnd.toISOString()}::timestamptz), 0) AS month_cents
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.facility_id = ${facilityId}
      AND b.status NOT IN ('cancelled', 'no_show')
      AND b.active = true
      AND b.is_demo = ${tutorialMode}
      AND b.start_time >= ${rangeStart.toISOString()}::timestamptz
      AND b.start_time < ${rangeEnd.toISOString()}::timestamptz
  `)

  // postgres driver returns iterable rows directly (no .rows wrapper);
  // aggregates come back as strings — normalize with Number().
  const row = (rows as unknown as Array<Record<string, number | string>>)[0] ?? {}
  const n = (v: number | string | undefined) => Number(v ?? 0)

  return {
    today: { count: n(row.today_count), revenueCents: n(row.today_cents) },
    thisWeek: { count: n(row.week_count), revenueCents: n(row.week_cents) },
    thisMonth: { count: n(row.month_count), revenueCents: n(row.month_cents) },
  }
}

/** Pending waitlist entries for the facility (mirrors GET /api/waitlist). */
export async function getPendingWaitlist(facilityId: string, tutorialMode: boolean) {
  await ensureWaitlistSchema()
  return db.query.waitlistEntries.findMany({
    where: and(
      eq(waitlistEntries.facilityId, facilityId),
      eq(waitlistEntries.status, 'pending'),
      eq(waitlistEntries.isDemo, tutorialMode), // is_demo filter — Phase 13
    ),
    orderBy: (t, { asc }) => [asc(t.earliestDate), asc(t.createdAt)],
    limit: 100,
  })
}

export interface DueResidentRow {
  residentId: string
  name: string
  roomNumber: string | null
  lastVisit: string
  usualCadenceDays: number
  daysSinceLastVisit: number
  suggestedServiceId: string | null
}

/**
 * Phase 16 G2 — residents DUE for a visit based on their own historical
 * cadence: lag() gaps over completed visits (last 18 months), median gap per
 * resident (≥3 visits), due when time-since-last-visit exceeds the median.
 * Top 6 by overdue-ness.
 */
export async function getDueForVisit(facilityId: string): Promise<DueResidentRow[]> {
  // P36 — the query LEFT JOINs resident_preferences; self-bootstrap first.
  const { ensureResidentPrefsSchema } = await import('@/lib/resident-prefs-ddl')
  await ensureResidentPrefsSchema()
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
      -- P36: the family's chosen visit rhythm overrides the learned median
      EXTRACT(EPOCH FROM COALESCE(
        CASE rp.visit_frequency
          WHEN 'weekly' THEN interval '7 days'
          WHEN 'biweekly' THEN interval '14 days'
          WHEN 'monthly' THEN interval '30 days'
        END,
        c.median_gap
      ))::bigint AS median_gap_seconds,
      EXTRACT(EPOCH FROM (now() - c.last_visit))::bigint AS since_last_seconds
    FROM cadence c
    JOIN residents r ON r.id = c.resident_id AND r.active = true AND r.is_demo = false
    LEFT JOIN resident_preferences rp ON rp.resident_id = c.resident_id
    WHERE now() - c.last_visit >= COALESCE(
        CASE rp.visit_frequency
          WHEN 'weekly' THEN interval '7 days'
          WHEN 'biweekly' THEN interval '14 days'
          WHEN 'monthly' THEN interval '30 days'
        END,
        c.median_gap
      )
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

  return rows.map((r) => ({
    residentId: r.resident_id,
    name: r.name,
    roomNumber: r.room_number,
    lastVisit: new Date(r.last_visit).toISOString(),
    usualCadenceDays: Math.round(Number(r.median_gap_seconds) / 86400),
    daysSinceLastVisit: Math.round(Number(r.since_last_seconds) / 86400),
    suggestedServiceId: mostUsed.get(r.resident_id) ?? null,
  }))
}
