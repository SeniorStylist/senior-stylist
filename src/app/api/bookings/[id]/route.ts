import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities, residents, stylists, services, profiles } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { eq, and, lt, gt, or, ne, gte, count, desc, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { isCalendarConfigured } from '@/lib/google-calendar/client'
import {
  updateCalendarEvent,
  deleteCalendarEvent,
} from '@/lib/google-calendar/sync'
import { updateStylistCalendarEvent, deleteStylistCalendarEvent } from '@/lib/google-calendar/oauth-client'
import { revalidateTag } from 'next/cache'
import { resolvePrice, validatePricingInput } from '@/lib/pricing'
import { toClientJson } from '@/lib/sanitize'

const updateSchema = z.object({
  residentId: z.string().uuid().optional(),
  stylistId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  serviceIds: z.array(z.string().uuid()).min(1).optional(),
  addonServiceIds: z.array(z.string().uuid()).optional(),
  startTime: z.string().datetime().optional(),
  priceCents: z.number().int().min(0).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).optional(),
  paymentStatus: z.enum(['unpaid', 'paid', 'waived']).optional(),
  cancellationReason: z.string().max(500).optional(),
  cancelFuture: z.boolean().optional(),
  selectedQuantity: z.number().int().min(1).max(1000).optional(),
  selectedOption: z.string().max(200).optional(),
  addonChecked: z.boolean().optional(),
  tipCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
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

    return Response.json({ data: toClientJson(data) })
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
    if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role) && facilityUser.role !== 'stylist') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
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

    // If service(s) change, fetch new service(s) for price/duration snapshots.
    // Multi-service: prefer updates.serviceIds when provided; fall back to single serviceId.
    let priceCents: number | undefined
    let durationMinutes: number | undefined
    let totalDurationMinutes: number | undefined
    let addonTotalCents: number | null | undefined
    let newServiceIds: string[] | undefined
    let newServiceNames: string[] | undefined
    let newPrimaryServiceId: string | undefined

    const incomingServiceIds: string[] | undefined =
      updates.serviceIds && updates.serviceIds.length > 0
        ? updates.serviceIds
        : updates.serviceId
          ? [updates.serviceId]
          : undefined

    const serviceChanged =
      !!incomingServiceIds &&
      (incomingServiceIds.length !== (existing.serviceIds?.length ?? 1) ||
        incomingServiceIds.some((id, i) => id !== (existing.serviceIds?.[i] ?? existing.serviceId)))

    if (incomingServiceIds && serviceChanged) {
      const svcRows = await db.query.services.findMany({
        where: and(eq(services.facilityId, facilityId), inArray(services.id, incomingServiceIds)),
      })
      if (svcRows.length !== incomingServiceIds.length) {
        return Response.json({ error: 'One or more services not found' }, { status: 404 })
      }
      const ordered = incomingServiceIds
        .map((id) => svcRows.find((s) => s.id === id))
        .filter((s): s is NonNullable<typeof s> => !!s)
      const primary = ordered[0]

      // Resolve pricing for the primary service; additional primaries resolve as fixed
      const priceInput = {
        quantity: updates.selectedQuantity,
        selectedOption: updates.selectedOption,
        includeAddon: updates.addonChecked,
      }
      const priceError = validatePricingInput(primary, priceInput)
      if (priceError) {
        return Response.json({ error: priceError }, { status: 422 })
      }
      const { priceCents: primaryResolved, addonTotalCents: primaryAddon } = resolvePrice(primary, priceInput)
      // price_cents only — never add tip_cents (tips go to stylist, not facility revenue)
      const additionalTotal = ordered.slice(1).reduce((sum, s) => sum + resolvePrice(s).priceCents, 0)

      // Addon-type services still counted separately below; here we compute primary total
      priceCents = primaryResolved + additionalTotal
      addonTotalCents = primaryAddon
      durationMinutes = primary.durationMinutes
      totalDurationMinutes = ordered.reduce((sum, s) => sum + s.durationMinutes, 0)
      newServiceIds = ordered.map((s) => s.id)
      newServiceNames = ordered.map((s) => s.name)
      newPrimaryServiceId = primary.id
    }

    // Recalculate endTime if startTime or service changed
    const effectiveDuration =
      totalDurationMinutes ?? existing.totalDurationMinutes ?? existing.durationMinutes ?? 30
    const endTime =
      updates.startTime || serviceChanged
        ? new Date(effectiveStartTime.getTime() + effectiveDuration * 60000)
        : undefined

    // Check stylist conflict if stylist or time window changed
    if (updates.stylistId || updates.startTime || serviceChanged) {
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
    if (newPrimaryServiceId !== undefined) setPayload.serviceId = newPrimaryServiceId
    if (newServiceIds !== undefined) setPayload.serviceIds = newServiceIds
    if (newServiceNames !== undefined) setPayload.serviceNames = newServiceNames
    if (totalDurationMinutes !== undefined) setPayload.totalDurationMinutes = totalDurationMinutes
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
    if (updates.selectedQuantity !== undefined) setPayload.selectedQuantity = updates.selectedQuantity
    if (updates.selectedOption !== undefined) setPayload.selectedOption = updates.selectedOption
    if (updates.addonServiceIds !== undefined) setPayload.addonServiceIds = updates.addonServiceIds.length > 0 ? updates.addonServiceIds : null
    if (addonTotalCents !== undefined) setPayload.addonTotalCents = addonTotalCents
    if (updates.tipCents !== undefined) setPayload.tipCents = updates.tipCents

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

          if (bookingWithRelations && bookingWithRelations.service) {
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

    // Per-stylist calendar sync — fire-and-forget
    if (updated.googleEventId) {
      db.query.stylists.findFirst({ where: eq(stylists.id, updated.stylistId) })
        .then(stl => {
          if (stl?.googleRefreshToken && stl?.googleCalendarId) {
            return db.query.bookings.findFirst({
              where: eq(bookings.id, id),
              with: { resident: true, service: true },
            }).then(bwr => {
              if (!bwr) return
              return updateStylistCalendarEvent(stl.googleRefreshToken!, stl.googleCalendarId!, updated.googleEventId!, {
                id: updated.id,
                startTime: updated.startTime,
                endTime: updated.endTime,
                priceCents: updated.priceCents,
                notes: updated.notes ?? null,
                residentName: bwr.resident?.name ?? '',
                stylistName: stl.name,
                serviceName: bwr.service?.name ?? '',
                servicePriceCents: bwr.service?.priceCents ?? 0,
                facilityId: updated.facilityId,
                residentId: updated.residentId,
                stylistId: updated.stylistId,
                serviceId: updated.serviceId ?? '',
              })
            })
          }
        })
        .catch(err => console.error('Stylist calendar sync failed:', err))
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
    return Response.json({ data: toClientJson(data) })
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
    if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role) && facilityUser.role !== 'stylist') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
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

    // Per-stylist calendar sync — fire-and-forget
    if (existing.googleEventId) {
      db.query.stylists.findFirst({ where: eq(stylists.id, existing.stylistId) })
        .then(stl => {
          if (stl?.googleRefreshToken && stl?.googleCalendarId) {
            return deleteStylistCalendarEvent(stl.googleRefreshToken!, stl.googleCalendarId!, existing.googleEventId!)
          }
        })
        .catch(err => console.error('Stylist calendar sync failed:', err))
    }

    revalidateTag('bookings', {})
    return Response.json({ data: cancelled })
  } catch (err) {
    console.error('DELETE /api/bookings/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
