import { db } from '@/db'
import { bookings, facilities, facilityUsers, profiles, stylists } from '@/db/schema'
import { and, eq, gte, lt, inArray } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { sendEmail, buildDailySummaryEmailHtml, type DigestFacilitySummary } from '@/lib/email'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Today in UTC (cron fires at 8am local, but we query UTC day window broadly)
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10) // YYYY-MM-DD

    // 1. Always send master roll-up to NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const masterEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    let masterSent = false
    if (masterEmail) {
      const allActiveFacilities = await db.query.facilities.findMany({
        where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
        columns: { id: true, name: true, facilityCode: true, timezone: true },
      })

      const facilitySummaries: DigestFacilitySummary[] = []
      for (const facility of allActiveFacilities) {
        const tz = facility.timezone ?? 'America/New_York'
        // UTC window for this calendar day in the facility's timezone
        const { start, end } = dayRangeInTz(todayStr, tz)

        const todayBookings = await db.query.bookings.findMany({
          where: and(
            eq(bookings.facilityId, facility.id),
            eq(bookings.active, true),
            eq(bookings.isDemo, false),
            gte(bookings.startTime, start),
            lt(bookings.startTime, end),
          ),
          with: { stylist: { columns: { name: true } } },
          columns: { id: true, status: true, stylistId: true },
        })

        const scheduled = todayBookings.filter((b) => b.status !== 'cancelled')
        if (scheduled.length === 0) continue

        const uniqueStylistNames = [
          ...new Set(scheduled.map((b) => (b as any).stylist?.name).filter(Boolean) as string[]),
        ]
        facilitySummaries.push({
          facilityName: facility.name,
          facilityCode: facility.facilityCode ?? null,
          appointmentCount: scheduled.length,
          stylistNames: uniqueStylistNames,
        })
      }

      if (facilitySummaries.length > 0) {
        const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        const html = buildDailySummaryEmailHtml({ dateLabel, facilities: facilitySummaries, isMasterDigest: true })
        masterSent = await sendEmail({
          to: masterEmail,
          subject: `Morning Digest — ${facilitySummaries.reduce((s, f) => s + f.appointmentCount, 0)} appointments today`,
          html,
        })
      }
    }

    // 2. Per-facility digest for opted-in facilities
    const optedInFacilities = await db.query.facilities.findMany({
      where: and(eq(facilities.active, true), eq(facilities.dailyDigestEnabled, true), eq(facilities.isDemo, false)),
      columns: { id: true, name: true, facilityCode: true, timezone: true },
    })

    let facilitiesSent = 0
    for (const facility of optedInFacilities) {
      const tz = facility.timezone ?? 'America/New_York'
      const { start, end } = dayRangeInTz(todayStr, tz)

      const todayBookings = await db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facility.id),
          eq(bookings.active, true),
          eq(bookings.isDemo, false),
          gte(bookings.startTime, start),
          lt(bookings.startTime, end),
        ),
        with: { stylist: { columns: { name: true } } },
        columns: { id: true, status: true },
      })

      const scheduled = todayBookings.filter((b) => b.status !== 'cancelled')

      // Find admin emails for this facility
      const admins = await db
        .select({ email: profiles.email })
        .from(facilityUsers)
        .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
        .where(and(eq(facilityUsers.facilityId, facility.id), eq(facilityUsers.role, 'admin')))

      const adminEmails = admins.map((a) => a.email).filter((e): e is string => !!e)
      if (adminEmails.length === 0) continue

      const uniqueStylistNames = [
        ...new Set(scheduled.map((b) => (b as any).stylist?.name).filter(Boolean) as string[]),
      ]

      const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      const html = buildDailySummaryEmailHtml({
        dateLabel,
        facilities: [{
          facilityName: facility.name,
          facilityCode: facility.facilityCode ?? null,
          appointmentCount: scheduled.length,
          stylistNames: uniqueStylistNames,
        }],
        isMasterDigest: false,
      })

      for (const email of adminEmails) {
        await sendEmail({
          to: email,
          subject: `Morning Digest — ${facility.name}: ${scheduled.length} appointments today`,
          html,
        }).catch(() => {})
      }
      facilitiesSent++
    }

    return Response.json({ data: { masterSent, facilitiesSent } })
  } catch (err) {
    console.error('[GET /api/cron/daily-digest] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function dayRangeInTz(dateStr: string, tz: string): { start: Date; end: Date } {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
    const parseLocal = (date: Date) => {
      const parts = fmt.formatToParts(date)
      const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? '0')
      return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
    }
    const [y, m, d] = dateStr.split('-').map(Number)
    // Find UTC time that corresponds to midnight in the given tz
    let probe = new Date(Date.UTC(y, m - 1, d, 0, 0, 0))
    for (let iter = 0; iter < 48; iter++) {
      const local = parseLocal(probe)
      if (local.year === y && local.month === m && local.day === d && local.hour === 0 && local.minute === 0) break
      probe = new Date(probe.getTime() - 30 * 60 * 1000)
    }
    return { start: probe, end: new Date(probe.getTime() + 24 * 60 * 60 * 1000) }
  } catch {
    const [y, m, d] = dateStr.split('-').map(Number)
    const start = new Date(Date.UTC(y, m - 1, d, 5, 0, 0)) // ~midnight ET
    return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
  }
}
