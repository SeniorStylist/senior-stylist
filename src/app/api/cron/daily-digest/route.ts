import { NextRequest } from 'next/server'
import { db } from '@/db'
import { bookings, facilities, facilityUsers, profiles } from '@/db/schema'
import { and, eq, gte, lt, inArray, notInArray } from 'drizzle-orm'
import { dayRangeInTimezone } from '@/lib/time'
import {
  buildDailySummaryEmailHtml,
  sendEmail,
  type DailySummaryStylistRow,
} from '@/lib/email'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Compute "yesterday" in UTC — the cron fires at 08:00 UTC so facilities in
    // any US timezone will have completed their prior calendar day.
    const nowUtc = new Date()
    const yesterdayUtc = new Date(nowUtc)
    yesterdayUtc.setUTCDate(nowUtc.getUTCDate() - 1)
    const yesterdayStr = yesterdayUtc.toISOString().slice(0, 10) // YYYY-MM-DD

    // Fetch all active, non-demo facilities with digest enabled + a contact email
    const enabledFacilities = await db.query.facilities.findMany({
      where: and(
        eq(facilities.active, true),
        eq(facilities.isDemo, false),
        eq(facilities.dailyDigestEnabled, true),
      ),
      columns: {
        id: true,
        name: true,
        facilityCode: true,
        timezone: true,
        contactEmail: true,
      },
    })

    if (enabledFacilities.length === 0) {
      return Response.json({ data: { sent: 0, skipped: 0 } })
    }

    // For each facility that has no contactEmail, try to find the admin email
    // from facility_users → profiles
    const facilitiesNeedingEmail = enabledFacilities
      .filter((f) => !f.contactEmail)
      .map((f) => f.id)

    const adminEmailMap = new Map<string, string>()
    if (facilitiesNeedingEmail.length > 0) {
      const admins = await db
        .select({
          facilityId: facilityUsers.facilityId,
          email: profiles.email,
        })
        .from(facilityUsers)
        .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
        .where(
          and(
            inArray(facilityUsers.facilityId, facilitiesNeedingEmail),
            eq(facilityUsers.role, 'admin'),
          ),
        )
      // One admin per facility (first one wins)
      for (const row of admins) {
        if (!adminEmailMap.has(row.facilityId) && row.email) {
          adminEmailMap.set(row.facilityId, row.email)
        }
      }
    }

    let sent = 0
    let skipped = 0

    for (const facility of enabledFacilities) {
      const recipientEmail = facility.contactEmail ?? adminEmailMap.get(facility.id)
      if (!recipientEmail) {
        skipped++
        continue
      }

      const tz = facility.timezone ?? 'America/New_York'
      const range = dayRangeInTimezone(yesterdayStr, tz)
      if (!range) {
        skipped++
        continue
      }

      // Fetch completed, active, non-demo bookings for this facility yesterday
      const rows = await db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facility.id),
          eq(bookings.status, 'completed'),
          eq(bookings.active, true),
          eq(bookings.isDemo, false),
          gte(bookings.startTime, range.start),
          lt(bookings.startTime, range.end),
        ),
        columns: {
          priceCents: true,
          addonTotalCents: true,
          tipCents: true,
          stylistId: true,
        },
        with: {
          stylist: {
            columns: { name: true },
          },
        },
      })

      if (rows.length === 0) {
        // Nothing happened yesterday — skip; no point sending an empty email
        skipped++
        continue
      }

      // Aggregate totals
      const totalRevenue = rows.reduce(
        (sum, r) => sum + (r.priceCents ?? 0) + (r.addonTotalCents ?? 0),
        0,
      )
      const totalTips = rows.reduce((sum, r) => sum + (r.tipCents ?? 0), 0)

      // Per-stylist breakdown
      const stylistMap = new Map<
        string,
        { name: string; count: number; revenue: number; tips: number }
      >()
      for (const row of rows) {
        const key = row.stylistId ?? '__unknown__'
        const name = row.stylist?.name ?? 'Unknown stylist'
        if (!stylistMap.has(key)) {
          stylistMap.set(key, { name, count: 0, revenue: 0, tips: 0 })
        }
        const entry = stylistMap.get(key)!
        entry.count++
        entry.revenue += (row.priceCents ?? 0) + (row.addonTotalCents ?? 0)
        entry.tips += row.tipCents ?? 0
      }

      const stylistRows: DailySummaryStylistRow[] = Array.from(stylistMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .map((s) => ({
          stylistName: s.name,
          completedCount: s.count,
          revenueCents: s.revenue,
          tipCents: s.tips,
        }))

      // Build friendly date label in the facility's timezone
      const dateLabel = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }).format(range.start)

      const { subject, html } = buildDailySummaryEmailHtml({
        facilityName: facility.name,
        facilityCode: facility.facilityCode ?? null,
        dateLabel,
        completedCount: rows.length,
        revenueCents: totalRevenue,
        tipCents: totalTips,
        stylists: stylistRows,
      })

      // Fire-and-forget — background digest; never blocks the cron response
      sendEmail({ to: recipientEmail, subject, html }).catch((err) => {
        console.error('[daily-digest] sendEmail failed', { facilityId: facility.id, err })
      })
      sent++
    }

    return Response.json({ data: { sent, skipped } })
  } catch (err) {
    console.error('GET /api/cron/daily-digest error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
