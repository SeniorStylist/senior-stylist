import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  residents,
  stylists,
  bookings,
  stylistFacilityAssignments,
  stylistAvailability,
  facilities,
} from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, eq, gt, desc, asc, sql } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { dayRangeInTimezone, getLocalParts } from '@/lib/time'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  type: z.enum(['resident', 'stylist']),
  id: z.string().uuid(),
})

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    const facilityUser = await getUserFacility(user.id)
    if (!isMaster && !facilityUser) {
      return Response.json({ error: 'No facility' }, { status: 400 })
    }

    const role = facilityUser?.role ?? ''
    if (role === 'viewer') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = querySchema.safeParse({
      type: request.nextUrl.searchParams.get('type'),
      id: request.nextUrl.searchParams.get('id'),
    })
    if (!parsed.success) {
      return Response.json({ error: 'Invalid params' }, { status: 400 })
    }
    const { type, id } = parsed.data

    const rl = await checkRateLimit('peek', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const callerFacilityId = facilityUser?.facilityId

    if (type === 'resident') {
      const resident = await db.query.residents.findFirst({
        where: and(eq(residents.id, id), eq(residents.active, true)),
      })
      if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

      if (!isMaster && callerFacilityId && resident.facilityId !== callerFacilityId) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }

      const residentFacility = await db.query.facilities.findFirst({
        where: eq(facilities.id, resident.facilityId),
        columns: { name: true, timezone: true },
      })

      const [lastVisitsRaw, nextVisitRaw] = await Promise.all([
        db.query.bookings.findMany({
          where: and(
            eq(bookings.residentId, id),
            eq(bookings.status, 'completed'),
            eq(bookings.active, true),
          ),
          with: {
            service: { columns: { name: true } },
            stylist: { columns: { name: true } },
          },
          orderBy: [desc(bookings.startTime)],
          limit: 3,
          columns: { startTime: true, rawServiceName: true },
        }),
        db.query.bookings.findFirst({
          where: and(
            eq(bookings.residentId, id),
            eq(bookings.status, 'scheduled'),
            eq(bookings.active, true),
            gt(bookings.startTime, new Date()),
          ),
          with: {
            service: { columns: { name: true } },
            stylist: { columns: { name: true } },
          },
          orderBy: [asc(bookings.startTime)],
          columns: { startTime: true, rawServiceName: true },
        }),
      ])

      const lastVisits = lastVisitsRaw.map((v) => ({
        startTime: v.startTime.toISOString(),
        serviceName: v.service?.name ?? v.rawServiceName ?? 'Unknown service',
        stylistName: v.stylist?.name ?? '—',
      }))
      const nextVisit = nextVisitRaw
        ? {
            startTime: nextVisitRaw.startTime.toISOString(),
            serviceName: nextVisitRaw.service?.name ?? nextVisitRaw.rawServiceName ?? 'Unknown service',
            stylistName: nextVisitRaw.stylist?.name ?? '—',
          }
        : null

      return Response.json({
        data: {
          type: 'resident' as const,
          facilityTimezone: residentFacility?.timezone ?? 'America/New_York',
          resident: {
            id: resident.id,
            name: resident.name,
            roomNumber: resident.roomNumber,
            facilityName: residentFacility?.name ?? '',
            poaName: resident.poaName,
            poaPhone: resident.poaPhone,
            poaEmail: resident.poaEmail,
            lastVisits,
            nextVisit,
          },
        },
      })
    }

    // type === 'stylist'
    const stylist = await db.query.stylists.findFirst({
      where: and(eq(stylists.id, id), eq(stylists.active, true)),
    })
    if (!stylist) return Response.json({ error: 'Not found' }, { status: 404 })

    let scopedFacilityId: string | null = null
    let scopedFacility: { name: string; timezone: string } | null = null

    if (isMaster) {
      // Prefer stylist.facilityId; fall back to first assignment
      if (stylist.facilityId) {
        const f = await db.query.facilities.findFirst({
          where: eq(facilities.id, stylist.facilityId),
          columns: { id: true, name: true, timezone: true },
        })
        if (f) {
          scopedFacilityId = f.id
          scopedFacility = { name: f.name, timezone: f.timezone ?? 'America/New_York' }
        }
      }
      if (!scopedFacilityId) {
        const firstAssign = await db
          .select({ facilityId: stylistFacilityAssignments.facilityId, name: facilities.name, timezone: facilities.timezone })
          .from(stylistFacilityAssignments)
          .innerJoin(facilities, eq(facilities.id, stylistFacilityAssignments.facilityId))
          .where(
            and(
              eq(stylistFacilityAssignments.stylistId, stylist.id),
              eq(stylistFacilityAssignments.active, true),
            ),
          )
          .limit(1)
        if (firstAssign.length > 0) {
          scopedFacilityId = firstAssign[0].facilityId
          scopedFacility = { name: firstAssign[0].name, timezone: firstAssign[0].timezone ?? 'America/New_York' }
        }
      }
    } else if (callerFacilityId) {
      // Caller can peek only stylists assigned to their facility
      const assign = await db
        .select({ name: facilities.name, timezone: facilities.timezone })
        .from(stylistFacilityAssignments)
        .innerJoin(facilities, eq(facilities.id, stylistFacilityAssignments.facilityId))
        .where(
          and(
            eq(stylistFacilityAssignments.stylistId, stylist.id),
            eq(stylistFacilityAssignments.facilityId, callerFacilityId),
            eq(stylistFacilityAssignments.active, true),
          ),
        )
        .limit(1)
      if (assign.length === 0) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      scopedFacilityId = callerFacilityId
      scopedFacility = { name: assign[0].name, timezone: assign[0].timezone ?? 'America/New_York' }
    }

    if (!scopedFacilityId || !scopedFacility) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const tz = scopedFacility.timezone

    // Today's date string in facility tz
    const nowParts = getLocalParts(new Date(), tz)
    const todayStr = `${nowParts.year}-${String(nowParts.month).padStart(2, '0')}-${String(nowParts.day).padStart(2, '0')}`
    const todayRange = dayRangeInTimezone(todayStr, tz)

    // Week range: Monday → next Monday (Mon-start week)
    // getLocalParts returns weekday short name; map to int 0=Sun..6=Sat, then shift to Mon=0
    const weekdayIdx = WEEKDAY_NAMES.indexOf(nowParts.weekday)
    const daysSinceMon = (weekdayIdx + 6) % 7 // 0 if Mon
    const weekStartRange = dayRangeInTimezone(todayStr, tz, -daysSinceMon)
    const weekEndRange = dayRangeInTimezone(todayStr, tz, 7 - daysSinceMon)

    if (!todayRange || !weekStartRange || !weekEndRange) {
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }

    const [availabilityRows, todayCountResult, weekCountResult] = await Promise.all([
      db.query.stylistAvailability.findMany({
        where: and(
          eq(stylistAvailability.stylistId, stylist.id),
          eq(stylistAvailability.facilityId, scopedFacilityId),
          eq(stylistAvailability.active, true),
        ),
        columns: { dayOfWeek: true },
      }),
      db.execute(
        sql`SELECT COUNT(*)::int AS n FROM bookings
            WHERE stylist_id = ${stylist.id}
              AND facility_id = ${scopedFacilityId}
              AND active = true
              AND status != 'cancelled'
              AND start_time >= ${todayRange.start.toISOString()}
              AND start_time < ${todayRange.end.toISOString()}`,
      ),
      db.execute(
        sql`SELECT COUNT(*)::int AS n FROM bookings
            WHERE stylist_id = ${stylist.id}
              AND facility_id = ${scopedFacilityId}
              AND active = true
              AND status != 'cancelled'
              AND start_time >= ${weekStartRange.start.toISOString()}
              AND start_time < ${weekEndRange.start.toISOString()}`,
      ),
    ])

    // postgres-js driver returns iterable rows directly (no .rows wrapper)
    const todayRow = (todayCountResult as unknown as Array<{ n: number | string }>)[0]
    const weekRow = (weekCountResult as unknown as Array<{ n: number | string }>)[0]
    const todayCount = Number(todayRow?.n ?? 0)
    const weekCount = Number(weekRow?.n ?? 0)

    const availableDays = availabilityRows
      .map((r) => WEEKDAY_NAMES[r.dayOfWeek])
      .filter(Boolean)
      // Sort Mon→Sun order
      .sort((a, b) => ((WEEKDAY_NAMES.indexOf(a) + 6) % 7) - ((WEEKDAY_NAMES.indexOf(b) + 6) % 7))

    return Response.json({
      data: {
        type: 'stylist' as const,
        facilityTimezone: tz,
        stylist: {
          id: stylist.id,
          name: stylist.name,
          stylistCode: stylist.stylistCode,
          facilityName: scopedFacility.name,
          status: stylist.status,
          availableDays,
          todayCount,
          weekCount,
        },
      },
    })
  } catch (err) {
    console.error('GET /api/peek error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
