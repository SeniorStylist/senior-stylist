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
    let facilitiesWithBookings = 0

    for (const facility of activeFacilities) {
      try {
        const tz = facility.timezone ?? 'America/New_York'
        // "Tomorrow" anchored to the FACILITY's local date (not UTC).
        const p = getLocalParts(new Date(), tz)
        const todayLocal = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
        const range = dayRangeInTimezone(todayLocal, tz, 1)
        if (!range) continue

        const rows = await db.query.bookings.findMany({
          where: and(
            eq(bookings.facilityId, facility.id),
            eq(bookings.active, true),
            eq(bookings.isDemo, false),
            ne(bookings.status, 'cancelled'),
            gte(bookings.startTime, range.start),
            lt(bookings.startTime, range.end),
          ),
          columns: { stylistId: true, startTime: true },
        })
        if (rows.length === 0) continue
        facilitiesWithBookings++

        // Group by stylist; find each stylist's earliest start.
        const byStylist = new Map<string, { count: number; first: Date }>()
        for (const r of rows) {
          const cur = byStylist.get(r.stylistId)
          const start = new Date(r.startTime)
          if (!cur) byStylist.set(r.stylistId, { count: 1, first: start })
          else {
            cur.count++
            if (start < cur.first) cur.first = start
          }
        }

        // One query for all profiles of tomorrow's stylists at this facility.
        const stylistIds = [...byStylist.keys()]
        const stylistProfiles = await db.query.profiles.findMany({
          where: inArray(profiles.stylistId, stylistIds),
          columns: { id: true, stylistId: true },
        })

        await Promise.allSettled(
          stylistProfiles.map(async (prof) => {
            const info = prof.stylistId ? byStylist.get(prof.stylistId) : undefined
            if (!info) return
            await sendPushToUser(prof.id, {
              title: `Tomorrow: ${info.count} appointment${info.count === 1 ? '' : 's'}`,
              body: `First at ${formatTimeInTz(info.first, tz)} — ${facility.name}`,
              url: '/dashboard',
            })
            stylistsNotified++
          }),
        )
      } catch (facilityErr) {
        console.error(`[schedule-reminders] facility ${facility.id} failed:`, facilityErr)
      }
    }

    return Response.json({ data: { facilities: activeFacilities.length, facilitiesWithBookings, stylistsNotified } })
  } catch (err) {
    console.error('GET /api/cron/schedule-reminders error:', err)
    return Response.json({ error: 'Internal — logged' }, { status: 500 })
  }
}
