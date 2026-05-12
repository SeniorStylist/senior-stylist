import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  bookings,
  facilities,
  profiles,
  stylistCheckins,
  stylistFacilityAssignments,
} from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, eq, gte, lt, notInArray, asc } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { dayRangeInTimezone } from '@/lib/time'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  facilityId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('checkin', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'stylist') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const json = await request.json()
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }
    const { facilityId, date } = parsed.data

    if (facilityId !== facilityUser.facilityId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { stylistId: true },
    })
    if (!profile?.stylistId) {
      return Response.json({ error: 'No stylist profile' }, { status: 403 })
    }
    const stylistId = profile.stylistId

    const assignment = await db.query.stylistFacilityAssignments.findFirst({
      where: and(
        eq(stylistFacilityAssignments.stylistId, stylistId),
        eq(stylistFacilityAssignments.facilityId, facilityId),
        eq(stylistFacilityAssignments.active, true),
      ),
    })
    if (!assignment) {
      return Response.json({ error: 'Stylist not assigned to this facility' }, { status: 403 })
    }

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { timezone: true },
    })
    const tz = facility?.timezone ?? 'America/New_York'
    const range = dayRangeInTimezone(date, tz)
    if (!range) return Response.json({ error: 'Invalid date' }, { status: 422 })

    const result = await db.transaction(async (tx) => {
      const existing = await tx.query.stylistCheckins.findFirst({
        where: and(
          eq(stylistCheckins.stylistId, stylistId),
          eq(stylistCheckins.facilityId, facilityId),
          eq(stylistCheckins.date, date),
        ),
      })
      if (existing) {
        return {
          delayMinutes: existing.delayMinutes,
          checkedInAt: existing.checkedInAt,
          firstAppointmentTime: null as string | null,
        }
      }

      const firstBooking = await tx.query.bookings.findFirst({
        where: and(
          eq(bookings.stylistId, stylistId),
          eq(bookings.facilityId, facilityId),
          eq(bookings.active, true),
          gte(bookings.startTime, range.start),
          lt(bookings.startTime, range.end),
          notInArray(bookings.status, ['cancelled']),
        ),
        columns: { startTime: true },
        orderBy: [asc(bookings.startTime)],
      })

      const now = new Date()
      const firstStart = firstBooking?.startTime ?? null
      const delayMinutes = firstStart
        ? Math.max(0, Math.floor((now.getTime() - new Date(firstStart).getTime()) / 60_000))
        : 0

      await tx.insert(stylistCheckins).values({
        stylistId,
        facilityId,
        date,
        checkedInAt: now,
        delayMinutes,
      })

      return {
        delayMinutes,
        checkedInAt: now,
        firstAppointmentTime: firstStart ? new Date(firstStart).toISOString() : null,
      }
    })

    return Response.json({
      data: {
        checkedIn: true,
        delayMinutes: result.delayMinutes,
        firstAppointmentTime: result.firstAppointmentTime,
      },
    })
  } catch (err) {
    console.error('POST /api/checkin error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
