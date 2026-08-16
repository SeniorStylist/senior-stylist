// P50 — family appointment requests land in the SIGN-UP-SHEET QUEUE.
//
// The old handler created a ghost `bookings` row: status='requested' at a
// fabricated 10:00 SERVER-LOCAL slot on the alphabetically-first stylist —
// indistinguishable from a real appointment on the calendar, invisible as a
// request, never confirmed to the family. Now a request is a real
// signup_sheet_entries row (the mature stylist-fits-you-in pipeline: queue,
// badge, drag-to-calendar, convert), the family's preferred stylist is
// honored, dates are facility-tz correct, and the family gets a "we got it"
// email immediately plus a confirmation when it's scheduled (P50-C4).
//
// Route path is kept — old clients and SW-cached portal pages keep working.

import { db } from '@/db'
import { facilities, residentPreferences, residents, services, signupSheetEntries } from '@/db/schema'
import { getPortalSession } from '@/lib/portal-auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { buildPortalRequestEmailHtml, buildRequestReceivedEmailHtml, sendEmail } from '@/lib/email'
import { ensureSignupSheetSchema } from '@/lib/signup-sheet-ddl'
import { resolveAssignedStylist } from '@/lib/signup-sheet-assignment'
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

/** Today's calendar date in the facility's timezone (YYYY-MM-DD). */
function todayInTz(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(new Date())
  }
}

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

    await ensureSignupSheetSchema()

    const svcRows = await db.query.services.findMany({
      where: and(
        eq(services.facilityId, residentRow.facilityId),
        inArray(services.id, serviceIds),
        eq(services.active, true),
      ),
      columns: { id: true, name: true },
    })
    if (svcRows.length !== serviceIds.length) {
      return Response.json({ error: 'One or more services not available' }, { status: 422 })
    }
    const orderedSvcs = serviceIds
      .map((id) => svcRows.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s)

    const [facility, residentDetail, prefs] = await Promise.all([
      db.query.facilities.findFirst({
        where: eq(facilities.id, residentRow.facilityId),
        columns: { id: true, name: true, contactEmail: true, timezone: true },
      }),
      db.query.residents.findFirst({
        where: eq(residents.id, residentId),
        columns: { roomNumber: true },
      }),
      db.query.residentPreferences.findFirst({
        where: eq(residentPreferences.residentId, residentId),
        columns: { preferredStylistId: true },
      }).catch(() => null),
    ])

    // The family's chosen stylist wins; else date-aware least-loaded; else the
    // fallback; else null (entry shows as unassigned — visible to everyone).
    const assignedToStylistId = await resolveAssignedStylist(
      residentRow.facilityId,
      preferredDateFrom ?? null,
      db,
      // P55 demoOnly:false — portal requests are always real entries; without
      // it Demo Sarah could win and hide the request from every real stylist.
      { preferredStylistId: prefs?.preferredStylistId ?? null, demoOnly: false },
    )

    // Multi-service policy: ONE entry per visit — the first service is the
    // primary; the rest ride in notes (convert creates one booking and the
    // BookingModal supports multi-select).
    const extraServices = orderedSvcs.slice(1).map((s) => s.name)
    const combinedNotes = [
      notes?.trim() || null,
      extraServices.length > 0 ? `Also requested: ${extraServices.join(', ')}` : null,
    ].filter(Boolean).join('\n') || null

    let entryId: string
    try {
      const [created] = await db
        .insert(signupSheetEntries)
        .values({
          facilityId: residentRow.facilityId,
          residentId: residentRow.residentId,
          residentName: residentRow.residentName,
          roomNumber: residentDetail?.roomNumber ?? null,
          serviceId: orderedSvcs[0].id,
          serviceName: orderedSvcs[0].name,
          // P54 — real multi-service arrays (includes the primary). The
          // "Also requested:" notes-append above STAYS for readability +
          // stale clients that haven't picked up the array rendering.
          serviceIds: orderedSvcs.map((s) => s.id),
          serviceNames: orderedSvcs.map((s) => s.name),
          requestedDate: todayInTz(facility?.timezone ?? 'America/New_York'),
          preferredDate: preferredDateFrom ?? null,
          preferredDateTo: preferredDateTo ?? null,
          notes: combinedNotes,
          createdBy: null,
          source: 'portal',
          createdByPortalAccountId: session.portalAccountId,
          assignedToStylistId,
          status: 'pending',
          isDemo: false,
        })
        .returning({ id: signupSheetEntries.id })
      entryId = created.id
    } catch (err) {
      console.error('[portal/request-booking] insert failed:', err)
      return Response.json({ error: 'Could not create request — please try again.' }, { status: 500 })
    }

    // Staff email (existing) + in-app bell for admins (P50).
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
      }).catch(() => {})
    }
    import('@/lib/notify').then(({ notifyFacilityAdmins }) =>
      notifyFacilityAdmins(residentRow.facilityId, {
        type: 'portal_request',
        title: 'New appointment request',
        body: `${residentRow.residentName} — ${orderedSvcs.map((s) => s.name).join(', ')} (from the family portal)`,
        url: '/signup-sheet',
      }),
    ).catch(() => {})

    // Family confirmation — the requester's own email (P50: the requester is
    // often NOT the poaEmail on file).
    sendEmail({
      to: session.email,
      subject: `Request received — ${residentRow.residentName} at ${facility?.name ?? residentRow.facilityName}`,
      html: buildRequestReceivedEmailHtml({
        residentName: residentRow.residentName,
        facilityName: facility?.name ?? residentRow.facilityName,
        serviceNames: orderedSvcs.map((s) => s.name),
        preferredDateFrom: preferredDateFrom ?? null,
        preferredDateTo: preferredDateTo ?? null,
      }),
    }).catch(() => {})

    revalidateTag('signup-sheet', {})
    return Response.json({ data: { entryId } })
  } catch (err) {
    console.error('POST /api/portal/request-booking error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
