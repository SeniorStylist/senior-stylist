import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  bookings,
  facilities,
  residents,
  services,
  signupSheetEntries,
  stylistFacilityAssignments,
  stylists,
} from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { and, eq, gt, inArray, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { resolvePrice, validatePricingInput } from '@/lib/pricing'
import { isCalendarConfigured } from '@/lib/google-calendar/client'
import { createCalendarEvent } from '@/lib/google-calendar/sync'

const convertSchema = z.object({
  residentId: z.string().uuid(),
  stylistId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
  serviceIds: z.array(z.string().uuid()).min(1).optional(),
  startTime: z.string().datetime(),
  notes: z.string().max(2000).optional(),
  selectedQuantity: z.number().int().min(1).max(1000).optional(),
  selectedOption: z.string().max(200).optional(),
  addonChecked: z.boolean().optional(),
  addonServiceIds: z.array(z.string().uuid()).optional().default([]),
  tipCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
}).refine((d) => d.serviceId || (d.serviceIds && d.serviceIds.length > 0), {
  message: 'serviceId or serviceIds is required',
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId, role } = facilityUser

    if (!isAdminOrAbove(role) && !isFacilityStaff(role) && role !== 'stylist') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const entry = await db.query.signupSheetEntries.findFirst({
      where: and(eq(signupSheetEntries.id, id), eq(signupSheetEntries.facilityId, facilityId)),
    })
    if (!entry) return Response.json({ error: 'Not found' }, { status: 404 })
    if (entry.status !== 'pending') {
      return Response.json({ error: `Entry is ${entry.status} — cannot convert` }, { status: 409 })
    }

    const body = await request.json()
    const parsed = convertSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { residentId, stylistId, startTime: startTimeStr, notes } = parsed.data

    const primaryServiceIds: string[] =
      parsed.data.serviceIds && parsed.data.serviceIds.length > 0
        ? parsed.data.serviceIds
        : parsed.data.serviceId
          ? [parsed.data.serviceId]
          : []

    // Verify resident, services, stylist scope
    const resident = await db.query.residents.findFirst({
      where: and(eq(residents.id, residentId), eq(residents.facilityId, facilityId)),
    })
    if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })

    const primarySvcRows = await db.query.services.findMany({
      where: and(eq(services.facilityId, facilityId), inArray(services.id, primaryServiceIds)),
    })
    if (primarySvcRows.length !== primaryServiceIds.length) {
      return Response.json({ error: 'One or more services not found' }, { status: 404 })
    }
    const primaryServices = primaryServiceIds
      .map((id) => primarySvcRows.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s)
    const service = primaryServices[0]

    const priceInput = {
      quantity: parsed.data.selectedQuantity,
      selectedOption: parsed.data.selectedOption,
      includeAddon: parsed.data.addonChecked,
    }
    const priceError = validatePricingInput(service, priceInput)
    if (priceError) return Response.json({ error: priceError }, { status: 422 })

    const { priceCents: primaryResolved, addonTotalCents } = resolvePrice(service, priceInput)
    const additionalPrimaryTotal = primaryServices
      .slice(1)
      .reduce((sum, s) => sum + resolvePrice(s).priceCents, 0)
    let resolvedPrice = primaryResolved + additionalPrimaryTotal

    const addonServiceIdsInput = parsed.data.addonServiceIds ?? []
    let multiAddonTotalCents = 0
    if (addonServiceIdsInput.length > 0) {
      const addonSvcs = await db.query.services.findMany({
        where: and(eq(services.facilityId, facilityId), inArray(services.id, addonServiceIdsInput)),
      })
      multiAddonTotalCents = addonSvcs.reduce((sum, s) => sum + (s.addonAmountCents ?? 0), 0)
    }
    const finalPriceCents = resolvedPrice + multiAddonTotalCents
    const finalAddonTotalCents = ((addonTotalCents ?? 0) + multiAddonTotalCents) || null
    const totalDurationMinutes = primaryServices.reduce((sum, s) => sum + s.durationMinutes, 0)

    const startTime = new Date(startTimeStr)
    const endTime = new Date(startTime.getTime() + totalDurationMinutes * 60000)

    // Verify stylist + assignment
    const stylist = await db.query.stylists.findFirst({
      where: and(eq(stylists.id, stylistId), eq(stylists.active, true), eq(stylists.status, 'active')),
    })
    if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })

    const [assignment] = await db
      .select({ id: stylistFacilityAssignments.id })
      .from(stylistFacilityAssignments)
      .where(and(
        eq(stylistFacilityAssignments.stylistId, stylistId),
        eq(stylistFacilityAssignments.facilityId, facilityId),
        eq(stylistFacilityAssignments.active, true),
      ))
      .limit(1)
    if (!assignment) return Response.json({ error: 'Stylist is not assigned to this facility' }, { status: 404 })

    // Conflict check
    const conflict = await db.query.bookings.findFirst({
      where: and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.stylistId, stylistId),
        or(eq(bookings.status, 'scheduled'), eq(bookings.status, 'completed')),
        lt(bookings.startTime, endTime),
        gt(bookings.endTime, startTime),
      ),
    })
    if (conflict) {
      return Response.json({ error: 'This stylist already has a booking at that time' }, { status: 409 })
    }

    // Atomic: create booking + update entry
    const result = await db.transaction(async (tx) => {
      const [booking] = await tx
        .insert(bookings)
        .values({
          facilityId,
          residentId,
          stylistId,
          serviceId: primaryServices[0].id,
          serviceIds: primaryServices.map((s) => s.id),
          serviceNames: primaryServices.map((s) => s.name),
          totalDurationMinutes,
          startTime,
          endTime,
          priceCents: finalPriceCents,
          durationMinutes: service.durationMinutes,
          notes: notes ?? null,
          selectedQuantity: parsed.data.selectedQuantity ?? null,
          selectedOption: parsed.data.selectedOption ?? null,
          addonTotalCents: finalAddonTotalCents,
          addonServiceIds: addonServiceIdsInput.length > 0 ? addonServiceIdsInput : null,
          status: 'scheduled',
          tipCents: parsed.data.tipCents ?? null,
        })
        .returning()

      await tx
        .update(signupSheetEntries)
        .set({ status: 'scheduled', bookingId: booking.id, updatedAt: new Date() })
        .where(eq(signupSheetEntries.id, entry.id))

      return booking
    })

    // GCal sync — fire-and-forget after the transaction commits
    if (isCalendarConfigured()) {
      ;(async () => {
        try {
          const facility = await db.query.facilities.findFirst({
            where: eq(facilities.id, facilityId),
          })
          if (facility?.calendarId) {
            const googleEventId = await createCalendarEvent(facility.calendarId, result, resident, stylist, service)
            await db.update(bookings).set({ googleEventId, syncError: null, updatedAt: new Date() }).where(eq(bookings.id, result.id))
          }
        } catch (gcalErr) {
          console.error('GCal sync failed (non-fatal):', gcalErr)
        }
      })()
    }

    revalidateTag('signup-sheet', {})
    revalidateTag('bookings', {})

    const data = await db.query.bookings.findFirst({
      where: eq(bookings.id, result.id),
      with: { resident: true, stylist: true, service: true },
    })

    return Response.json({ data })
  } catch (err) {
    console.error('POST /api/signup-sheet/[id]/convert failed:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
