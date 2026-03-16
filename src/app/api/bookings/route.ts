import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities, residents, stylists, services } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and, gte, lte, lt, gt, or } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { isCalendarConfigured } from '@/lib/google-calendar/client'
import { createCalendarEvent } from '@/lib/google-calendar/sync'

const createSchema = z.object({
  residentId: z.string().uuid(),
  stylistId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startTime: z.string().datetime(),
  notes: z.string().optional(),
})

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const { searchParams } = new URL(request.url)
    const startParam = searchParams.get('start')
    const endParam = searchParams.get('end')

    const conditions = [eq(bookings.facilityId, facilityId)]

    if (startParam) {
      conditions.push(gte(bookings.startTime, new Date(startParam)))
    }
    if (endParam) {
      conditions.push(lte(bookings.startTime, new Date(endParam)))
    }

    const data = await db.query.bookings.findMany({
      where: and(...conditions),
      with: {
        resident: true,
        stylist: true,
        service: true,
      },
      orderBy: (t, { asc }) => [asc(t.startTime)],
    })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/bookings error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { residentId, stylistId, serviceId, startTime: startTimeStr, notes } = parsed.data

    // Verify resident belongs to this facility
    const resident = await db.query.residents.findFirst({
      where: and(eq(residents.id, residentId), eq(residents.facilityId, facilityId)),
    })
    if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })

    // Verify stylist belongs to this facility
    const stylist = await db.query.stylists.findFirst({
      where: and(eq(stylists.id, stylistId), eq(stylists.facilityId, facilityId)),
    })
    if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })

    // Fetch service from DB for authoritative priceCents and durationMinutes
    const service = await db.query.services.findFirst({
      where: and(eq(services.id, serviceId), eq(services.facilityId, facilityId)),
    })
    if (!service) return Response.json({ error: 'Service not found' }, { status: 404 })

    const startTime = new Date(startTimeStr)
    const endTime = new Date(startTime.getTime() + service.durationMinutes * 60000)

    // Check for stylist conflict
    const conflict = await db.query.bookings.findFirst({
      where: and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.stylistId, stylistId),
        or(
          eq(bookings.status, 'scheduled'),
          eq(bookings.status, 'completed')
        ),
        lt(bookings.startTime, endTime),
        gt(bookings.endTime, startTime)
      ),
    })

    if (conflict) {
      return Response.json(
        { error: 'This stylist already has a booking at that time' },
        { status: 409 }
      )
    }

    // Insert booking
    const [booking] = await db
      .insert(bookings)
      .values({
        facilityId,
        residentId,
        stylistId,
        serviceId,
        startTime,
        endTime,
        priceCents: service.priceCents,
        durationMinutes: service.durationMinutes,
        notes: notes ?? null,
        status: 'scheduled',
      })
      .returning()

    // Attempt GCal sync
    try {
      if (isCalendarConfigured()) {
        const facility = await db.query.facilities.findFirst({
          where: eq(facilities.id, facilityId),
        })

        if (facility?.calendarId) {
          const googleEventId = await createCalendarEvent(
            facility.calendarId,
            booking,
            resident,
            stylist,
            service
          )

          await db
            .update(bookings)
            .set({ googleEventId, syncError: null, updatedAt: new Date() })
            .where(eq(bookings.id, booking.id))
        }
      }
    } catch (gcalErr) {
      const errorMessage = gcalErr instanceof Error ? gcalErr.message : String(gcalErr)
      await db
        .update(bookings)
        .set({ syncError: errorMessage, updatedAt: new Date() })
        .where(eq(bookings.id, booking.id))
    }

    // Fetch final booking with relations
    const data = await db.query.bookings.findFirst({
      where: eq(bookings.id, booking.id),
      with: {
        resident: true,
        stylist: true,
        service: true,
      },
    })

    return Response.json({ data }, { status: 201 })
  } catch (err) {
    console.error('POST /api/bookings error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
