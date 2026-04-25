import { db } from '@/db'
import { bookings, facilities, services, stylistFacilityAssignments, stylists } from '@/db/schema'
import { getPortalSession } from '@/lib/portal-auth'
import { resolvePrice } from '@/lib/pricing'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { buildPortalRequestEmailHtml, sendEmail } from '@/lib/email'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  residentId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).min(1).max(6),
  preferredDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  preferredDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await getPortalSession()
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('portalRequestBooking', session.portalAccountId)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const body = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 })

    const { residentId, serviceIds, preferredDateFrom, preferredDateTo, notes } = parsed.data

    const residentRow = session.residents.find((r) => r.residentId === residentId)
    if (!residentRow) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const svcRows = await db.query.services.findMany({
      where: and(
        eq(services.facilityId, residentRow.facilityId),
        inArray(services.id, serviceIds),
        eq(services.active, true),
      ),
    })
    if (svcRows.length !== serviceIds.length) {
      return Response.json({ error: 'One or more services not available' }, { status: 422 })
    }
    const orderedSvcs = serviceIds
      .map((id) => svcRows.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s)

    const totalDurationMinutes = orderedSvcs.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0)
    const priceCents = orderedSvcs.reduce((sum, s) => sum + resolvePrice(s).priceCents, 0)

    const stylistRow = await db
      .select({ id: stylists.id })
      .from(stylistFacilityAssignments)
      .innerJoin(stylists, eq(stylists.id, stylistFacilityAssignments.stylistId))
      .where(
        and(
          eq(stylistFacilityAssignments.facilityId, residentRow.facilityId),
          eq(stylistFacilityAssignments.active, true),
          eq(stylists.active, true),
          eq(stylists.status, 'active'),
        ),
      )
      .orderBy(stylists.name)
      .limit(1)

    if (stylistRow.length === 0) {
      return Response.json(
        { error: 'This facility has no stylists yet — please contact the office.' },
        { status: 400 },
      )
    }
    const placeholderStylistId = stylistRow[0].id

    const baseDate = preferredDateFrom ? new Date(preferredDateFrom + 'T10:00:00') : (() => {
      const t = new Date()
      t.setDate(t.getDate() + 1)
      t.setHours(10, 0, 0, 0)
      return t
    })()
    const startTime = baseDate
    const endTime = new Date(startTime.getTime() + Math.max(totalDurationMinutes, 15) * 60 * 1000)

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, residentRow.facilityId),
      columns: { id: true, name: true, contactEmail: true },
    })

    let bookingId: string | null = null
    try {
      const [created] = await db
        .insert(bookings)
        .values({
          facilityId: residentRow.facilityId,
          residentId: residentRow.residentId,
          stylistId: placeholderStylistId,
          serviceId: orderedSvcs[0].id,
          serviceIds: orderedSvcs.map((s) => s.id),
          serviceNames: orderedSvcs.map((s) => s.name),
          totalDurationMinutes,
          durationMinutes: orderedSvcs[0].durationMinutes,
          priceCents,
          startTime,
          endTime,
          status: 'requested',
          paymentStatus: 'unpaid',
          requestedByPortal: true,
          portalNotes: notes ?? null,
        })
        .returning({ id: bookings.id })
      bookingId = created.id
    } catch (err) {
      console.error('[portal/request-booking] insert failed:', err)
      return Response.json({ error: 'Could not create request — please try again.' }, { status: 500 })
    }

    const adminUrl = `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')}/dashboard`
    const recipients = new Set<string>()
    if (facility?.contactEmail) recipients.add(facility.contactEmail)
    if (process.env.NEXT_PUBLIC_ADMIN_EMAIL) recipients.add(process.env.NEXT_PUBLIC_ADMIN_EMAIL)
    for (const to of recipients) {
      sendEmail({
        to,
        subject: `New service request: ${residentRow.residentName} at ${facility?.name ?? residentRow.facilityName}`,
        html: buildPortalRequestEmailHtml({
          residentName: residentRow.residentName,
          facilityName: facility?.name ?? residentRow.facilityName,
          serviceNames: orderedSvcs.map((s) => s.name),
          preferredDateFrom: preferredDateFrom ?? null,
          preferredDateTo: preferredDateTo ?? null,
          notes: notes ?? null,
          adminUrl,
        }),
      })
    }

    revalidateTag('bookings', {})
    return Response.json({ data: { bookingId } })
  } catch (err) {
    console.error('POST /api/portal/request-booking error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
