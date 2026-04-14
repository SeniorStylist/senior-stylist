import { db } from '@/db'
import { residents, bookings, services, facilities, stylists } from '@/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { sendEmail, buildBookingConfirmationEmailHtml } from '@/lib/email'
import { resolvePrice } from '@/lib/pricing'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { resolveAvailableStylists, pickStylistWithLeastLoad } from '@/lib/portal-assignment'

const bookSchema = z
  .object({
    serviceId: z.string().uuid().optional(),
    serviceIds: z.array(z.string().uuid()).min(1).optional(),
    // stylistId optional + ignored for back-compat
    stylistId: z.string().uuid().optional(),
    startTime: z.string().datetime(),
    selectedQuantity: z.number().int().min(1).max(1000).optional(),
    selectedOption: z.string().max(200).optional(),
    addonServiceIds: z.array(z.string().uuid()).optional().default([]),
  })
  .refine((d) => d.serviceId || (d.serviceIds && d.serviceIds.length > 0), {
    message: 'serviceId or serviceIds is required',
  })

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params

    const rl = await checkRateLimit('portalBook', token)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const resident = await db.query.residents.findFirst({
      where: eq(residents.portalToken, token),
    })

    if (!resident) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = bookSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { startTime } = parsed.data
    const allServiceIds = parsed.data.serviceIds ?? [parsed.data.serviceId!]
    const primaryServiceId = allServiceIds[0]

    const primaryService = await db.query.services.findFirst({
      where: and(eq(services.id, primaryServiceId), eq(services.facilityId, resident.facilityId)),
    })
    if (!primaryService) {
      return Response.json({ error: 'Service not found' }, { status: 404 })
    }

    const resolvedPrimary = resolvePrice(primaryService, {
      quantity: parsed.data.selectedQuantity,
      selectedOption: parsed.data.selectedOption,
    })

    const addonServiceIds = parsed.data.addonServiceIds ?? []
    let addonTotalCents = 0
    if (addonServiceIds.length > 0) {
      const addonSvcs = await db.query.services.findMany({
        where: and(
          inArray(services.id, addonServiceIds),
          eq(services.facilityId, resident.facilityId),
        ),
      })
      if (addonSvcs.length !== addonServiceIds.length) {
        return Response.json({ error: 'Invalid add-on service' }, { status: 400 })
      }
      addonTotalCents = addonSvcs.reduce(
        (sum, s) => sum + (s.addonAmountCents ?? s.priceCents ?? 0),
        0,
      )
    }

    let additionalPriceCents = 0
    let additionalDurationMinutes = 0
    if (allServiceIds.length > 1) {
      const additionalIds = allServiceIds.slice(1)
      const additionalSvcs = await db.query.services.findMany({
        where: and(
          inArray(services.id, additionalIds),
          eq(services.facilityId, resident.facilityId),
        ),
      })
      if (additionalSvcs.length !== additionalIds.length) {
        return Response.json({ error: 'Invalid service' }, { status: 400 })
      }
      additionalPriceCents = additionalSvcs.reduce(
        (sum, s) => sum + resolvePrice(s).priceCents,
        0,
      )
      additionalDurationMinutes = additionalSvcs.reduce(
        (sum, s) => sum + s.durationMinutes,
        0,
      )
    }

    const totalPriceCents = resolvedPrimary.priceCents + addonTotalCents + additionalPriceCents
    const totalDurationMinutes = primaryService.durationMinutes + additionalDurationMinutes

    const start = new Date(startTime)
    const end = new Date(start.getTime() + totalDurationMinutes * 60 * 1000)

    // Server-side auto-assignment
    const candidates = await resolveAvailableStylists({
      facilityId: resident.facilityId,
      startTime: start,
      endTime: end,
    })
    if (candidates.length === 0) {
      return Response.json({ error: 'No stylist available at that time' }, { status: 409 })
    }
    const picked = await pickStylistWithLeastLoad(candidates, {
      facilityId: resident.facilityId,
      date: start,
    })
    if (!picked) {
      return Response.json({ error: 'No stylist available at that time' }, { status: 409 })
    }

    const [created] = await db
      .insert(bookings)
      .values({
        facilityId: resident.facilityId,
        residentId: resident.id,
        stylistId: picked.id,
        serviceId: primaryServiceId,
        serviceIds: allServiceIds,
        startTime: start,
        endTime: end,
        priceCents: totalPriceCents,
        durationMinutes: totalDurationMinutes,
        selectedQuantity: parsed.data.selectedQuantity ?? null,
        selectedOption: parsed.data.selectedOption ?? null,
        addonServiceIds: addonServiceIds.length > 0 ? addonServiceIds : null,
        addonTotalCents: addonTotalCents || null,
        status: 'scheduled',
        paymentStatus: 'unpaid',
      })
      .returning()

    if (resident.poaEmail && resident.portalToken && resident.poaNotificationsEnabled !== false) {
      const [facility, stylist] = await Promise.all([
        db.query.facilities.findFirst({ where: eq(facilities.id, resident.facilityId) }),
        db.query.stylists.findFirst({ where: eq(stylists.id, picked.id) }),
      ])
      const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${resident.portalToken}`
      const tz = facility?.timezone ?? 'America/New_York'
      const poaDateStr = start.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: tz,
      })
      const poaTimeStr = start.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: tz,
      })
      const poaHtml = buildBookingConfirmationEmailHtml({
        residentName: resident.name,
        serviceName: primaryService.name,
        stylistName: stylist?.name ?? 'Stylist',
        dateStr: poaDateStr,
        timeStr: poaTimeStr,
        priceStr: `$${(totalPriceCents / 100).toFixed(2)}`,
        facilityName: facility?.name ?? 'Senior Stylist',
        portalUrl,
        bookedBy: 'portal',
      })
      sendEmail({
        to: resident.poaEmail,
        subject: `Appointment confirmed for ${resident.name}`,
        html: poaHtml,
      }).catch(console.error)
    }

    return Response.json({ data: JSON.parse(JSON.stringify(created)) }, { status: 201 })
  } catch (err) {
    console.error('POST /api/portal/[token]/book error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
