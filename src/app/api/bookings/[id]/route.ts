import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities, residents, stylists, services, profiles } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and, lt, gt, or, ne, gte, count, desc } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { isCalendarConfigured } from '@/lib/google-calendar/client'
import {
  updateCalendarEvent,
  deleteCalendarEvent,
} from '@/lib/google-calendar/sync'
import { revalidateTag } from 'next/cache'

const updateSchema = z.object({
  residentId: z.string().uuid().optional(),
  stylistId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  startTime: z.string().datetime().optional(),
  priceCents: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).optional(),
  paymentStatus: z.enum(['unpaid', 'paid', 'waived']).optional(),
  cancellationReason: z.string().optional(),
  cancelFuture: z.boolean().optional(),
})

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const data = await db.query.bookings.findFirst({
      where: and(eq(bookings.id, id), eq(bookings.facilityId, facilityId)),
      with: {
        resident: true,
        stylist: true,
        service: true,
      },
    })

    if (!data) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/bookings/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    // Load current booking
    const existing = await db.query.bookings.findFirst({
      where: and(eq(bookings.id, id), eq(bookings.facilityId, facilityId)),
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    // Stylist can only edit their own bookings
    if (facilityUser.role === 'stylist') {
      const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, user.id) })
      if (!profile?.stylistId || existing.stylistId !== profile.stylistId) {
        return Response.json({ error: 'You can only edit your own bookings' }, { status: 403 })
      }
    }

    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { cancelFuture, ...updates } = parsed.data

    // Handle cancel-future for recurring bookings
    if (cancelFuture && existing.recurringParentId) {
      await db
        .update(bookings)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(bookings.facilityId, facilityId),
            eq(bookings.recurringParentId, existing.recurringParentId),
            gte(bookings.startTime, existing.startTime)
          )
        )
      // Also cancel the parent if this IS the parent
    } else if (cancelFuture && existing.recurring && !existing.recurringParentId) {
      await db
        .update(bookings)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(bookings.facilityId, facilityId),
            eq(bookings.recurringParentId, existing.id),
            gte(bookings.startTime, existing.startTime)
          )
        )
      await db
        .update(bookings)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(and(eq(bookings.id, id), eq(bookings.facilityId, facilityId)))
      return Response.json({ data: { ...existing, status: 'cancelled' } })
    }

    // Resolve the effective values after the update
    const effectiveStylistId = updates.stylistId ?? existing.stylistId
    const effectiveServiceId = updates.serviceId ?? existing.serviceId
    const effectiveStartTime = updates.startTime
      ? new Date(updates.startTime)
      : existing.startTime

    // If residentId is changing, verify it belongs to facility
    if (updates.residentId && updates.residentId !== existing.residentId) {
      const resident = await db.query.residents.findFirst({
        where: and(
          eq(residents.id, updates.residentId),
          eq(residents.facilityId, facilityId)
        ),
      })
      if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })
    }

    // If stylistId is changing, verify it belongs to facility
    if (updates.stylistId && updates.stylistId !== existing.stylistId) {
      const stylist = await db.query.stylists.findFirst({
        where: and(
          eq(stylists.id, updates.stylistId),
          eq(stylists.facilityId, facilityId)
        ),
      })
      if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })
    }

    // If serviceId changes, fetch new service for price/duration snapshots
    let priceCents: number | undefined
    let durationMinutes: number | undefined

    if (updates.serviceId && updates.serviceId !== existing.serviceId) {
      const service = await db.query.services.findFirst({
        where: and(
          eq(services.id, updates.serviceId),
          eq(services.facilityId, facilityId)
        ),
      })
      if (!service) return Response.json({ error: 'Service not found' }, { status: 404 })
      priceCents = service.priceCents
      durationMinutes = service.durationMinutes
    }

    // Recalculate endTime if startTime or service changed
    const effectiveDuration =
      durationMinutes ?? existing.durationMinutes ?? 30
    const endTime =
      updates.startTime || updates.serviceId
        ? new Date(effectiveStartTime.getTime() + effectiveDuration * 60000)
        : undefined

    // Check stylist conflict if stylist or time window changed
    if (updates.stylistId || updates.startTime || updates.serviceId) {
      const effectiveEndTime =
        endTime ??
        new Date(effectiveStartTime.getTime() + effectiveDuration * 60000)

      const conflict = await db.query.bookings.findFirst({
        where: and(
          eq(bookings.facilityId, facilityId),
          eq(bookings.stylistId, effectiveStylistId),
          ne(bookings.id, id),
          or(
            eq(bookings.status, 'scheduled'),
            eq(bookings.status, 'completed')
          ),
          lt(bookings.startTime, effectiveEndTime),
          gt(bookings.endTime, effectiveStartTime)
        ),
      })

      if (conflict) {
        return Response.json(
          { error: 'This stylist already has a booking at that time' },
          { status: 409 }
        )
      }
    }

    // Build the update payload
    const setPayload: Record<string, unknown> = { updatedAt: new Date() }

    if (updates.residentId !== undefined) setPayload.residentId = updates.residentId
    if (updates.stylistId !== undefined) setPayload.stylistId = updates.stylistId
    if (updates.serviceId !== undefined) setPayload.serviceId = updates.serviceId
    if (updates.startTime !== undefined) setPayload.startTime = effectiveStartTime
    if (endTime !== undefined) setPayload.endTime = endTime
    if (priceCents !== undefined) setPayload.priceCents = priceCents
    if (durationMinutes !== undefined) setPayload.durationMinutes = durationMinutes
    // Direct priceCents override takes precedence over service-change priceCents
    if (updates.priceCents !== undefined) setPayload.priceCents = updates.priceCents
    if (updates.notes !== undefined) setPayload.notes = updates.notes
    if (updates.status !== undefined) setPayload.status = updates.status
    if (updates.paymentStatus !== undefined) setPayload.paymentStatus = updates.paymentStatus
    if (updates.cancellationReason !== undefined) setPayload.cancellationReason = updates.cancellationReason

    const [updated] = await db
      .update(bookings)
      .set(setPayload)
      .where(and(eq(bookings.id, id), eq(bookings.facilityId, facilityId)))
      .returning()

    // Auto-set default service after 3+ completions with same service
    if (updates.status === 'completed') {
      try {
        const counts = await db
          .select({ serviceId: bookings.serviceId, total: count() })
          .from(bookings)
          .where(
            and(
              eq(bookings.residentId, updated.residentId),
              eq(bookings.status, 'completed'),
              eq(bookings.facilityId, facilityId)
            )
          )
          .groupBy(bookings.serviceId)
          .orderBy(desc(count()))
          .limit(1)

        if (counts[0] && counts[0].total >= 3) {
          await db
            .update(residents)
            .set({ defaultServiceId: counts[0].serviceId, updatedAt: new Date() })
            .where(eq(residents.id, updated.residentId))
        }
      } catch {
        // Non-critical — don't fail the request
      }
    }

    // Attempt GCal sync
    try {
      if (isCalendarConfigured() && updated.googleEventId) {
        const facility = await db.query.facilities.findFirst({
          where: eq(facilities.id, facilityId),
        })

        if (facility?.calendarId) {
          const bookingWithRelations = await db.query.bookings.findFirst({
            where: eq(bookings.id, id),
            with: { resident: true, stylist: true, service: true },
          })

          if (bookingWithRelations) {
            await updateCalendarEvent(
              facility.calendarId,
              updated.googleEventId,
              bookingWithRelations,
              bookingWithRelations.resident,
              bookingWithRelations.stylist,
              bookingWithRelations.service
            )

            await db
              .update(bookings)
              .set({ syncError: null, updatedAt: new Date() })
              .where(eq(bookings.id, id))
          }
        }
      }
    } catch (gcalErr) {
      const errorMessage = gcalErr instanceof Error ? gcalErr.message : String(gcalErr)
      await db
        .update(bookings)
        .set({ syncError: errorMessage, updatedAt: new Date() })
        .where(eq(bookings.id, id))
    }

    // Return final booking with relations
    const data = await db.query.bookings.findFirst({
      where: eq(bookings.id, id),
      with: {
        resident: true,
        stylist: true,
        service: true,
      },
    })

    revalidateTag('bookings', {})
    return Response.json({ data })
  } catch (err) {
    console.error('PUT /api/bookings/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const existing = await db.query.bookings.findFirst({
      where: and(eq(bookings.id, id), eq(bookings.facilityId, facilityId)),
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    const [cancelled] = await db
      .update(bookings)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(bookings.id, id), eq(bookings.facilityId, facilityId)))
      .returning()

    // Attempt GCal deletion
    try {
      if (existing.googleEventId && isCalendarConfigured()) {
        const facility = await db.query.facilities.findFirst({
          where: eq(facilities.id, facilityId),
        })

        if (facility?.calendarId) {
          await deleteCalendarEvent(facility.calendarId, existing.googleEventId)
        }
      }
    } catch (gcalErr) {
      const errorMessage = gcalErr instanceof Error ? gcalErr.message : String(gcalErr)
      await db
        .update(bookings)
        .set({ syncError: errorMessage, updatedAt: new Date() })
        .where(eq(bookings.id, id))
    }

    revalidateTag('bookings', {})
    return Response.json({ data: cancelled })
  } catch (err) {
    console.error('DELETE /api/bookings/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
