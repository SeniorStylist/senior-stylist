// W6: nightly "tomorrow's schedule" push to stylists — "Tomorrow: N appointments,
// first at 9:00 AM — Facility". Fires ~evening US time (22:00 UTC, vercel.json).
//
// Self-gating: sendPushToUser no-ops for users with no push subscription, so
// having push enabled IS the opt-in — no preference column needed. Stylists with
// no login profile are skipped. Never throws per-facility; best-effort.

import { db } from '@/db'
import { bookings, facilities, profiles } from '@/db/schema'
import { and, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { dayRangeInTimezone, getLocalParts, formatTimeInTz } from '@/lib/time'
import { sendPushToUser } from '@/lib/push'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const activeFacilities = await db.query.facilities.findMany({
      where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
      columns: { id: true, name: true, timezone: true },
    })

    let stylistsNotified = 0

    // Per-facility "tomorrow" windows (facility-local dates differ by timezone).
    // Computed in JS so the whole cron needs only THREE queries total — with the
    // max:1 pooled connection, a per-facility query loop serializes into hundreds
    // of round-trips and risks the 60s cap at ~100+ facilities.
    const windows = new Map<string, { start: Date; end: Date; tz: string; name: string }>()
    for (const facility of activeFacilities) {
      const tz = facility.timezone ?? 'America/New_York'
      const p = getLocalParts(new Date(), tz)
      const todayLocal = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
      const range = dayRangeInTimezone(todayLocal, tz, 1)
      if (range) windows.set(facility.id, { ...range, tz, name: facility.name })
    }
    if (windows.size === 0) {
      return Response.json({ data: { facilities: 0, facilitiesWithBookings: 0, stylistsNotified: 0 } })
    }

    // One bookings query over the union window; rows are re-filtered per facility
    // against that facility's own local-tomorrow range below.
    const allWindows = [...windows.values()]
    const globalStart = new Date(Math.min(...allWindows.map((w) => w.start.getTime())))
    const globalEnd = new Date(Math.max(...allWindows.map((w) => w.end.getTime())))
    const rows = await db.query.bookings.findMany({
      where: and(
        inArray(bookings.facilityId, [...windows.keys()]),
        eq(bookings.active, true),
        eq(bookings.isDemo, false),
        ne(bookings.status, 'cancelled'),
        gte(bookings.startTime, globalStart),
        lt(bookings.startTime, globalEnd),
      ),
      columns: { facilityId: true, stylistId: true, startTime: true },
    })

    // Group by (facility, stylist); track each stylist's earliest start per facility.
    const byFacilityStylist = new Map<string, { facilityId: string; stylistId: string; count: number; first: Date }>()
    for (const r of rows) {
      const w = windows.get(r.facilityId)
      if (!w) continue
      const start = new Date(r.startTime)
      if (start < w.start || start >= w.end) continue // outside THIS facility's local tomorrow
      const key = `${r.facilityId}|${r.stylistId}`
      const cur = byFacilityStylist.get(key)
      if (!cur) byFacilityStylist.set(key, { facilityId: r.facilityId, stylistId: r.stylistId, count: 1, first: start })
      else {
        cur.count++
        if (start < cur.first) cur.first = start
      }
    }
    const facilitiesWithBookings = new Set([...byFacilityStylist.values()].map((v) => v.facilityId)).size

    // One profiles query for every stylist with bookings tomorrow, any facility.
    const allStylistIds = [...new Set([...byFacilityStylist.values()].map((v) => v.stylistId))]
    const stylistProfiles = allStylistIds.length
      ? await db.query.profiles.findMany({
          where: inArray(profiles.stylistId, allStylistIds),
          columns: { id: true, stylistId: true },
        })
      : []
    const profileByStylist = new Map(stylistProfiles.map((p) => [p.stylistId, p.id]))

    await Promise.allSettled(
      [...byFacilityStylist.values()].map(async (info) => {
        const userId = profileByStylist.get(info.stylistId)
        const w = windows.get(info.facilityId)
        if (!userId || !w) return
        await sendPushToUser(userId, {
          title: `Tomorrow: ${info.count} appointment${info.count === 1 ? '' : 's'}`,
          body: `First at ${formatTimeInTz(info.first, w.tz)} — ${w.name}`,
          url: '/dashboard',
        })
        stylistsNotified++
      }),
    )

    return Response.json({ data: { facilities: activeFacilities.length, facilitiesWithBookings, stylistsNotified } })
  } catch (err) {
    console.error('GET /api/cron/schedule-reminders error:', err)
    return Response.json({ error: 'Internal — logged' }, { status: 500 })
  }
}
