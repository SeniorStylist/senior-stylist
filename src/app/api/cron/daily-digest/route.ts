import { db } from '@/db'
import { bookings, facilities, facilityUsers, profiles, residents } from '@/db/schema'
import { and, eq, gte, isNotNull, lt, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { dayRangeInTimezone } from '@/lib/time'
import { sendEmail, buildDailySummaryEmailHtml, type DigestFacilitySummary } from '@/lib/email'
import { notifyManyUsers } from '@/lib/notify'

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

    // All queries are batched — with the max:1 pooled connection, a per-facility
    // query loop serializes into hundreds of round-trips at ~100+ facilities.
    const allActiveFacilities = await db.query.facilities.findMany({
      where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
      columns: { id: true, name: true, facilityCode: true, timezone: true, dailyDigestEnabled: true },
    })

    // Per-facility UTC window for today's calendar date in the facility's tz.
    const windows = new Map<string, { start: Date; end: Date }>()
    for (const f of allActiveFacilities) {
      const tz = f.timezone ?? 'America/New_York'
      const range = dayRangeInTimezone(todayStr, tz) ?? fallbackDayRange(todayStr)
      windows.set(f.id, range)
    }

    // ONE bookings query over the union window; rows re-filtered per facility below.
    const allWindows = [...windows.values()]
    const globalStart = new Date(Math.min(...allWindows.map((w) => w.start.getTime())))
    const globalEnd = new Date(Math.max(...allWindows.map((w) => w.end.getTime())))
    const rows = allActiveFacilities.length
      ? await db.query.bookings.findMany({
          where: and(
            inArray(bookings.facilityId, allActiveFacilities.map((f) => f.id)),
            eq(bookings.active, true),
            eq(bookings.isDemo, false),
            gte(bookings.startTime, globalStart),
            lt(bookings.startTime, globalEnd),
          ),
          with: { stylist: { columns: { name: true } } },
          columns: { id: true, status: true, stylistId: true, facilityId: true, startTime: true },
        })
      : []

    // Group scheduled (non-cancelled) bookings per facility, within its own window.
    const perFacility = new Map<string, { count: number; stylistNames: Set<string> }>()
    for (const b of rows) {
      if (b.status === 'cancelled') continue
      const w = windows.get(b.facilityId)
      if (!w) continue
      const start = new Date(b.startTime)
      if (start < w.start || start >= w.end) continue
      let agg = perFacility.get(b.facilityId)
      if (!agg) {
        agg = { count: 0, stylistNames: new Set<string>() }
        perFacility.set(b.facilityId, agg)
      }
      agg.count++
      const stylistName = (b as { stylist?: { name?: string | null } | null }).stylist?.name
      if (stylistName) agg.stylistNames.add(stylistName)
    }

    // Phase 15 F3 — resident birthdays (today + next 7 days). ONE batched query;
    // month-day matching in JS. The cron fires at 8am UTC (0-4am US local), so the
    // UTC calendar date equals every US facility's local date.
    const dobResidents = allActiveFacilities.length
      ? await db.query.residents.findMany({
          where: and(
            inArray(residents.facilityId, allActiveFacilities.map((f) => f.id)),
            eq(residents.active, true),
            eq(residents.isDemo, false), // is_demo filter — Phase 13
            isNotNull(residents.dateOfBirth),
          ),
          columns: { facilityId: true, name: true, roomNumber: true, dateOfBirth: true },
        })
      : []
    const upcomingMonthDays: string[] = [] // 'MM-DD' for today..+7 (UTC-derived, see above)
    for (let i = 0; i <= 7; i++) {
      const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000)
      upcomingMonthDays.push(d.toISOString().slice(5, 10))
    }
    const birthdaysByFacility = new Map<string, { name: string; dateLabel: string; isToday: boolean }[]>()
    const todayBirthdays: { facilityId: string; name: string; roomNumber: string | null }[] = []
    for (const r of dobResidents) {
      const monthDay = String(r.dateOfBirth).slice(5, 10)
      const idx = upcomingMonthDays.indexOf(monthDay)
      if (idx === -1) continue
      const when = new Date(now.getTime() + idx * 24 * 60 * 60 * 1000)
      const entry = {
        name: r.name,
        dateLabel: when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
        isToday: idx === 0,
      }
      const list = birthdaysByFacility.get(r.facilityId) ?? []
      list.push(entry)
      birthdaysByFacility.set(r.facilityId, list)
      if (idx === 0) todayBirthdays.push({ facilityId: r.facilityId, name: r.name, roomNumber: r.roomNumber })
    }

    const summaryFor = (f: (typeof allActiveFacilities)[number]): DigestFacilitySummary | null => {
      const agg = perFacility.get(f.id)
      const birthdays = birthdaysByFacility.get(f.id)
      // Include a facility with zero appointments if it has upcoming birthdays.
      if ((!agg || agg.count === 0) && (!birthdays || birthdays.length === 0)) return null
      return {
        facilityName: f.name,
        facilityCode: f.facilityCode ?? null,
        appointmentCount: agg?.count ?? 0,
        stylistNames: agg ? [...agg.stylistNames] : [],
        birthdays,
      }
    }

    // Day-of birthday bell/push to facility admins — ONE admin join across all
    // affected facilities + ONE batched insert (never notifyFacilityAdmins in a loop).
    if (todayBirthdays.length > 0) {
      try {
        const affectedIds = [...new Set(todayBirthdays.map((b) => b.facilityId))]
        const admins = await db
          .select({ userId: facilityUsers.userId, facilityId: facilityUsers.facilityId })
          .from(facilityUsers)
          .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
          .where(and(inArray(facilityUsers.facilityId, affectedIds), eq(facilityUsers.role, 'admin')))
        const rows = admins.flatMap((a) =>
          todayBirthdays
            .filter((b) => b.facilityId === a.facilityId)
            .map((b) => ({
              userId: a.userId,
              payload: {
                type: 'birthday' as const,
                title: '🎂 Resident birthday today',
                body: b.roomNumber ? `${b.name} (Room ${b.roomNumber})` : b.name,
                url: '/residents',
                facilityId: b.facilityId,
              },
            })),
        )
        await notifyManyUsers(rows)
      } catch (err) {
        console.error('[daily-digest] birthday notify failed:', err)
      }
    }

    const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    // 1. Master roll-up to NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const masterEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    let masterSent = false
    if (masterEmail) {
      const facilitySummaries = allActiveFacilities
        .map(summaryFor)
        .filter((s): s is DigestFacilitySummary => s !== null)
      if (facilitySummaries.length > 0) {
        const html = buildDailySummaryEmailHtml({ dateLabel, facilities: facilitySummaries, isMasterDigest: true })
        masterSent = await sendEmail({
          to: masterEmail,
          subject: `Morning Digest — ${facilitySummaries.reduce((s, f) => s + f.appointmentCount, 0)} appointments today`,
          html,
        })
      }
    }

    // 2. Per-facility digest for opted-in facilities. ONE admin-emails query.
    const optedIn = allActiveFacilities.filter((f) => f.dailyDigestEnabled)
    let facilitiesSent = 0
    if (optedIn.length > 0) {
      const admins = await db
        .select({ facilityId: facilityUsers.facilityId, email: profiles.email })
        .from(facilityUsers)
        .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
        .where(and(inArray(facilityUsers.facilityId, optedIn.map((f) => f.id)), eq(facilityUsers.role, 'admin')))
      const adminsByFacility = new Map<string, string[]>()
      for (const a of admins) {
        if (!a.email) continue
        const list = adminsByFacility.get(a.facilityId) ?? []
        list.push(a.email)
        adminsByFacility.set(a.facilityId, list)
      }

      for (const facility of optedIn) {
        const adminEmails = adminsByFacility.get(facility.id) ?? []
        if (adminEmails.length === 0) continue

        const agg = perFacility.get(facility.id)
        const summary: DigestFacilitySummary = {
          facilityName: facility.name,
          facilityCode: facility.facilityCode ?? null,
          appointmentCount: agg?.count ?? 0,
          stylistNames: agg ? [...agg.stylistNames] : [],
          birthdays: birthdaysByFacility.get(facility.id),
        }
        const html = buildDailySummaryEmailHtml({ dateLabel, facilities: [summary], isMasterDigest: false })

        for (const email of adminEmails) {
          await sendEmail({
            to: email,
            subject: `Morning Digest — ${facility.name}: ${summary.appointmentCount} appointments today`,
            html,
          }).catch(() => {})
        }
        facilitiesSent++
      }
    }

    return Response.json({ data: { masterSent, facilitiesSent } })
  } catch (err) {
    console.error('[GET /api/cron/daily-digest] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Fallback when dayRangeInTimezone returns null (bad tz string): ~midnight ET.
function fallbackDayRange(dateStr: string): { start: Date; end: Date } {
  const [y, m, d] = dateStr.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, d, 5, 0, 0))
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
}
