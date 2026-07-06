// Phase 15 F2 — weekly owner digest. Runs Monday 12:00 UTC (vercel.json) and
// emails NEXT_PUBLIC_SUPER_ADMIN_EMAIL a per-facility rollup of the previous
// Mon→Mon week: completed appointments, service revenue (price + addons — never
// tips), payments received, cancellations, and new residents.
//
// All queries are batched (max:1 pool rule — never per-facility loops): one
// facilities query, one union-window bookings query re-filtered per facility in
// JS, one qb_payments date-range query, one residents query.

import { db } from '@/db'
import { bookings, facilities, qbPayments, residents } from '@/db/schema'
import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { dayRangeInTimezone } from '@/lib/time'
import { sendEmail, buildWeeklyDigestEmailHtml, type WeeklyFacilitySummary } from '@/lib/email'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const masterEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!masterEmail) {
      return Response.json({ data: { sent: false, reason: 'NEXT_PUBLIC_SUPER_ADMIN_EMAIL unset' } })
    }

    // Previous Mon→Mon by UTC calendar date. The cron fires Monday 12:00 UTC
    // (4-8am US local, still Monday everywhere in the US), so UTC weekday is safe.
    const now = new Date()
    const utcDow = now.getUTCDay() // 1 = Monday when the cron fires
    const daysSinceMonday = (utcDow + 6) % 7
    const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday))
    const lastMonday = new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000)
    const weekStartStr = lastMonday.toISOString().slice(0, 10)
    const weekEndStr = thisMonday.toISOString().slice(0, 10) // exclusive

    const activeFacilities = await db.query.facilities.findMany({
      where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
      columns: { id: true, name: true, facilityCode: true, timezone: true },
    })
    if (activeFacilities.length === 0) {
      return Response.json({ data: { sent: false, reason: 'no facilities' } })
    }
    const facilityIds = activeFacilities.map((f) => f.id)

    // Per-facility UTC window for [lastMonday, thisMonday) in the facility's tz.
    const windows = new Map<string, { start: Date; end: Date }>()
    for (const f of activeFacilities) {
      const tz = f.timezone ?? 'America/New_York'
      const start = dayRangeInTimezone(weekStartStr, tz)?.start ?? lastMonday
      const end = dayRangeInTimezone(weekEndStr, tz)?.start ?? thisMonday
      windows.set(f.id, { start, end })
    }
    const allWindows = [...windows.values()]
    const globalStart = new Date(Math.min(...allWindows.map((w) => w.start.getTime())))
    const globalEnd = new Date(Math.max(...allWindows.map((w) => w.end.getTime())))

    const [weekBookings, weekPayments, newResidentRows] = await Promise.all([
      db.query.bookings.findMany({
        where: and(
          inArray(bookings.facilityId, facilityIds),
          eq(bookings.active, true),
          eq(bookings.isDemo, false), // is_demo filter — Phase 13
          gte(bookings.startTime, globalStart),
          lt(bookings.startTime, globalEnd),
        ),
        columns: { facilityId: true, startTime: true, status: true, priceCents: true, addonTotalCents: true },
      }),
      // paymentDate is a plain date column — a string range covers all timezones.
      db.query.qbPayments.findMany({
        where: and(
          inArray(qbPayments.facilityId, facilityIds),
          eq(qbPayments.isDemo, false), // is_demo filter — Phase 13
          gte(qbPayments.paymentDate, weekStartStr),
          lt(qbPayments.paymentDate, weekEndStr),
        ),
        columns: { facilityId: true, amountCents: true },
      }),
      db.query.residents.findMany({
        where: and(
          inArray(residents.facilityId, facilityIds),
          eq(residents.isDemo, false), // is_demo filter — Phase 13
          gte(residents.createdAt, globalStart),
          lt(residents.createdAt, globalEnd),
        ),
        columns: { facilityId: true },
      }),
    ])

    const agg = new Map<string, { completed: number; revenue: number; payments: number; cancelled: number; newResidents: number }>()
    const get = (id: string) => {
      let a = agg.get(id)
      if (!a) {
        a = { completed: 0, revenue: 0, payments: 0, cancelled: 0, newResidents: 0 }
        agg.set(id, a)
      }
      return a
    }
    for (const b of weekBookings) {
      const w = windows.get(b.facilityId)
      if (!w) continue
      const start = new Date(b.startTime)
      if (start < w.start || start >= w.end) continue // outside THIS facility's local week
      const a = get(b.facilityId)
      if (b.status === 'completed') {
        a.completed++
        // price_cents + addon_total_cents only — never add tip_cents
        a.revenue += (b.priceCents ?? 0) + (b.addonTotalCents ?? 0)
      } else if (b.status === 'cancelled') {
        a.cancelled++
      }
    }
    for (const p of weekPayments) get(p.facilityId).payments += p.amountCents
    for (const r of newResidentRows) get(r.facilityId).newResidents++

    const summaries: WeeklyFacilitySummary[] = activeFacilities
      .flatMap((f) => {
        const a = agg.get(f.id)
        if (!a || (a.completed === 0 && a.payments === 0 && a.cancelled === 0 && a.newResidents === 0)) return []
        return [{
          facilityName: f.name,
          facilityCode: f.facilityCode ?? null,
          completedCount: a.completed,
          revenueCents: a.revenue,
          paymentsCents: a.payments,
          cancelledCount: a.cancelled,
          newResidents: a.newResidents,
        }]
      })
      .sort((a, b) => b.revenueCents - a.revenueCents)

    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    const sunday = new Date(thisMonday.getTime() - 24 * 60 * 60 * 1000)
    const weekLabel = `${fmt(lastMonday)} – ${fmt(sunday)}, ${sunday.getUTCFullYear()}`

    const totalAppts = summaries.reduce((s, f) => s + f.completedCount, 0)
    // Awaited — cron context, the email IS the work.
    const sent = await sendEmail({
      to: masterEmail,
      subject: `Weekly Digest — ${totalAppts} appointments · ${weekLabel}`,
      html: buildWeeklyDigestEmailHtml({ weekLabel, facilities: summaries }),
    })

    return Response.json({ data: { sent, facilities: summaries.length, weekLabel } })
  } catch (err) {
    console.error('GET /api/cron/weekly-digest error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
