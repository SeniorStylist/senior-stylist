// Phase 16 G8 — copy a salon day: clone one day's bookings onto another date at
// the same facility-local wall-clock times. Conflicts / unavailable stylists are
// skipped (recurring-route pattern) and reported, so a retry is near-idempotent —
// already-copied slots conflict and skip.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { and, eq, gt, gte, inArray, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { dayRangeInTimezone, toDateTimeLocalInTz, fromDateTimeLocalInTz } from '@/lib/time'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { isTutorialRequest } from '@/lib/help/tutorial-request'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const schema = z
  .object({
    sourceDate: z.string().regex(DATE_RE),
    targetDate: z.string().regex(DATE_RE),
  })
  .refine((d) => d.sourceDate !== d.targetDate, { message: 'Pick a different target date' })

export async function POST(request: NextRequest) {
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

    const rl = await checkRateLimit('copyDay', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 422 })
    }
    const { sourceDate, targetDate } = parsed.data
    const isDemo = isTutorialRequest(request)

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { timezone: true },
    })
    const tz = facility?.timezone ?? 'America/New_York'
    const sourceRange = dayRangeInTimezone(sourceDate, tz)
    if (!sourceRange) return Response.json({ error: 'Invalid source date' }, { status: 422 })

    const sourceBookings = await db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.active, true),
        eq(bookings.isDemo, isDemo), // is_demo filter — Phase 13
        inArray(bookings.status, ['scheduled', 'completed']),
        gte(bookings.startTime, sourceRange.start),
        lt(bookings.startTime, sourceRange.end),
      ),
      with: { resident: { columns: { id: true, name: true, active: true } } },
      orderBy: (t, { asc }) => [asc(t.startTime)],
    })
    if (sourceBookings.length === 0) {
      return Response.json({ error: 'No appointments on that day to copy' }, { status: 404 })
    }

    let created = 0
    const skipped: { residentName: string; reason: string }[] = []

    for (const src of sourceBookings) {
      const residentName = src.resident?.name ?? 'Resident'
      if (!src.resident?.active) {
        skipped.push({ residentName, reason: 'Resident is no longer active' })
        continue
      }

      // Same facility-local wall-clock time on the target date (DST-safe:
      // round-trip through the facility-tz datetime-local string, not ms offsets).
      const localTime = toDateTimeLocalInTz(src.startTime, tz).slice(11, 16) // 'HH:MM'
      const startTime = fromDateTimeLocalInTz(`${targetDate}T${localTime}`, tz)
      const durationMs =
        new Date(src.endTime).getTime() - new Date(src.startTime).getTime()
      const endTime = new Date(startTime.getTime() + Math.max(durationMs, 15 * 60 * 1000))

      // Stylist conflict check (same stylist, overlapping non-cancelled)
      const conflict = await db.query.bookings.findFirst({
        where: and(
          eq(bookings.facilityId, facilityId),
          eq(bookings.stylistId, src.stylistId),
          or(eq(bookings.status, 'scheduled'), eq(bookings.status, 'completed')),
          lt(bookings.startTime, endTime),
          gt(bookings.endTime, startTime),
        ),
        columns: { id: true },
      })
      if (conflict) {
        skipped.push({ residentName, reason: `Stylist already booked at ${localTime}` })
        continue
      }
      // Resident double-booking check on the target date
      const residentConflict = await db.query.bookings.findFirst({
        where: and(
          eq(bookings.facilityId, facilityId),
          eq(bookings.residentId, src.residentId),
          or(eq(bookings.status, 'scheduled'), eq(bookings.status, 'requested')),
          lt(bookings.startTime, endTime),
          gt(bookings.endTime, startTime),
        ),
        columns: { id: true },
      })
      if (residentConflict) {
        skipped.push({ residentName, reason: 'Already has an appointment then' })
        continue
      }

      try {
        await db.insert(bookings).values({
          facilityId,
          residentId: src.residentId,
          stylistId: src.stylistId,
          serviceId: src.serviceId,
          serviceIds: src.serviceIds,
          serviceNames: src.serviceNames,
          totalDurationMinutes: src.totalDurationMinutes,
          durationMinutes: src.durationMinutes,
          startTime,
          endTime,
          priceCents: src.priceCents,
          addonTotalCents: src.addonTotalCents,
          addonServiceIds: src.addonServiceIds,
          selectedQuantity: src.selectedQuantity,
          selectedOption: src.selectedOption,
          notes: src.notes,
          status: 'scheduled',
          isDemo,
        })
        created++
      } catch {
        skipped.push({ residentName, reason: 'Could not create the booking' })
      }
    }

    revalidateTag('bookings', {})
    return Response.json({ data: { created, skipped } })
  } catch (err) {
    console.error('POST /api/bookings/copy-day error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
