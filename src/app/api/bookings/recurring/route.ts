import { db } from '@/db'
import { bookings, services } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { createClient } from '@/lib/supabase/server'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { addDays, addWeeks, addMonths } from 'date-fns'
import { resolvePrice, validatePricingInput } from '@/lib/pricing'

const recurringSchema = z.object({
  residentId: z.string().uuid(),
  stylistId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
  serviceIds: z.array(z.string().uuid()).min(1).optional(),
  addonServiceIds: z.array(z.string().uuid()).optional().default([]),
  startTime: z.string().datetime(),
  notes: z.string().optional(),
  recurringRule: z.enum(['weekly', 'biweekly', 'monthly']),
  recurringEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  selectedQuantity: z.number().int().min(1).optional(),
  selectedOption: z.string().optional(),
  addonChecked: z.boolean().optional(),
}).refine((d) => d.serviceId || (d.serviceIds && d.serviceIds.length > 0), {
  message: 'serviceId or serviceIds is required',
})

type RecurringRule = 'weekly' | 'biweekly' | 'monthly'

function advanceDate(d: Date, rule: RecurringRule): Date {
  if (rule === 'weekly') return addWeeks(d, 1)
  if (rule === 'biweekly') return addDays(d, 14)
  return addMonths(d, 1)
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 403 })

    const body = await request.json()
    const parsed = recurringSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 })

    const { residentId, stylistId, startTime, notes, recurringRule, recurringEndDate, selectedQuantity, selectedOption, addonChecked } = parsed.data

    // Normalize to primary service id list
    const primaryServiceIds: string[] =
      parsed.data.serviceIds && parsed.data.serviceIds.length > 0
        ? parsed.data.serviceIds
        : parsed.data.serviceId
          ? [parsed.data.serviceId]
          : []
    if (primaryServiceIds.length === 0) {
      return Response.json({ error: 'serviceId or serviceIds is required' }, { status: 422 })
    }

    const svcRows = await db.query.services.findMany({
      where: and(eq(services.facilityId, facilityUser.facilityId), inArray(services.id, primaryServiceIds)),
    })
    if (svcRows.length !== primaryServiceIds.length) {
      return Response.json({ error: 'One or more services not found' }, { status: 404 })
    }
    const primaryServices = primaryServiceIds
      .map((id) => svcRows.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s)
    const primary = primaryServices[0]

    // Resolve pricing (primary gets pricing inputs; additional primaries use fixed)
    const priceInput = { quantity: selectedQuantity, selectedOption, includeAddon: addonChecked }
    const priceError = validatePricingInput(primary, priceInput)
    if (priceError) return Response.json({ error: priceError }, { status: 422 })
    const { priceCents: primaryResolved, addonTotalCents: primaryAddon } = resolvePrice(primary, priceInput)
    const additionalTotal = primaryServices.slice(1).reduce((sum, s) => sum + resolvePrice(s).priceCents, 0)

    // Resolve addon-type services
    const addonServiceIdsInput = parsed.data.addonServiceIds ?? []
    let multiAddonTotalCents = 0
    if (addonServiceIdsInput.length > 0) {
      const addonSvcs = await db.query.services.findMany({
        where: and(eq(services.facilityId, facilityUser.facilityId), inArray(services.id, addonServiceIdsInput)),
      })
      multiAddonTotalCents = addonSvcs.reduce((sum, s) => sum + (s.addonAmountCents ?? 0), 0)
    }
    const resolvedPrice = primaryResolved + additionalTotal + multiAddonTotalCents
    const addonTotalCents = ((primaryAddon ?? 0) + multiAddonTotalCents) || null
    const totalDurationMinutes = primaryServices.reduce((sum, s) => sum + s.durationMinutes, 0)

    const endDateLimit = new Date(recurringEndDate + 'T23:59:59Z')
    const parentStart = new Date(startTime)
    const parentEnd = new Date(parentStart.getTime() + totalDurationMinutes * 60 * 1000)

    const sharedValues = {
      facilityId: facilityUser.facilityId,
      residentId,
      stylistId,
      serviceId: primary.id,
      serviceIds: primaryServices.map((s) => s.id),
      serviceNames: primaryServices.map((s) => s.name),
      totalDurationMinutes,
      priceCents: resolvedPrice,
      durationMinutes: primary.durationMinutes,
      selectedQuantity: selectedQuantity ?? null,
      selectedOption: selectedOption ?? null,
      addonTotalCents,
      addonServiceIds: addonServiceIdsInput.length > 0 ? addonServiceIdsInput : null,
      notes: notes ?? null,
      status: 'scheduled' as const,
      paymentStatus: 'unpaid',
      recurring: true,
      recurringRule,
      recurringEndDate,
    }

    const [parent] = await db.insert(bookings).values({
      ...sharedValues,
      startTime: parentStart,
      endTime: parentEnd,
    }).returning()

    let count = 0
    let currentStart = advanceDate(parentStart, recurringRule)

    while (currentStart <= endDateLimit) {
      const currentEnd = new Date(currentStart.getTime() + totalDurationMinutes * 60 * 1000)
      try {
        await db.insert(bookings).values({
          ...sharedValues,
          startTime: currentStart,
          endTime: currentEnd,
          recurringParentId: parent.id,
        })
        count++
      } catch {
        // Skip on conflict (e.g. stylist overlap)
      }
      currentStart = advanceDate(currentStart, recurringRule)
    }

    return Response.json({ data: { parentId: parent.id, count: count + 1 } })
  } catch (err) {
    console.error('POST /api/bookings/recurring error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
