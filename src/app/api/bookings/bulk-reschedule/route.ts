import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities, profiles } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getLocalParts } from '@/lib/time'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  bookingIds: z.array(z.string().uuid()).min(1).max(50),
  shiftMinutes: z.number().int().min(1).max(480),
})

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('bulkReschedule', user.id)
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
    const { bookingIds, shiftMinutes } = parsed.data

    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { stylistId: true },
    })
    if (!profile?.stylistId) {
      return Response.json({ error: 'No stylist profile' }, { status: 403 })
    }
    const stylistId = profile.stylistId

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityUser.facilityId),
      columns: { timezone: true },
    })
    const tz = facility?.timezone ?? 'America/New_York'
    const today = getLocalParts(new Date(), tz)
    const todayKey = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`

    const updated = await db.transaction(async (tx) => {
      const rows = await tx.query.bookings.findMany({
        where: inArray(bookings.id, bookingIds),
      })

      const invalid: { id: string; reason: string }[] = []
      for (const b of rows) {
        if (b.stylistId !== stylistId) {
          invalid.push({ id: b.id, reason: 'Not your booking' })
          continue
        }
        if (b.facilityId !== facilityUser.facilityId) {
          invalid.push({ id: b.id, reason: 'Wrong facility' })
          continue
        }
        if (b.status === 'cancelled' || b.status === 'completed') {
          invalid.push({ id: b.id, reason: `Status ${b.status}` })
          continue
        }
        const local = getLocalParts(b.startTime, tz)
        const bookingKey = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`
        if (bookingKey !== todayKey) {
          invalid.push({ id: b.id, reason: 'Not today' })
          continue
        }
      }
      if (invalid.length > 0) {
        throw new Error(`INVALID:${JSON.stringify(invalid)}`)
      }
      if (rows.length !== bookingIds.length) {
        throw new Error('NOTFOUND')
      }

      const shiftMs = shiftMinutes * 60_000
      for (const b of rows) {
        await tx
          .update(bookings)
          .set({
            startTime: new Date(new Date(b.startTime).getTime() + shiftMs),
            endTime: new Date(new Date(b.endTime).getTime() + shiftMs),
          })
          .where(eq(bookings.id, b.id))
      }
      return rows.length
    })

    revalidateTag('bookings', {})

    return Response.json({ data: { updated } })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('INVALID:')) {
      const invalid = JSON.parse(err.message.slice('INVALID:'.length))
      return Response.json({ error: 'Some bookings cannot be rescheduled', invalid }, { status: 422 })
    }
    if (err instanceof Error && err.message === 'NOTFOUND') {
      return Response.json({ error: 'One or more bookings not found' }, { status: 404 })
    }
    console.error('PUT /api/bookings/bulk-reschedule error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
