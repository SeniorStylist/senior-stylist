// P50 — family appointment requests land in the SIGN-UP-SHEET QUEUE.
//
// The old handler created a ghost `bookings` row: status='requested' at a
// fabricated 10:00 SERVER-LOCAL slot on the alphabetically-first stylist —
// indistinguishable from a real appointment on the calendar, invisible as a
// request, never confirmed to the family. Now a request is a real
// signup_sheet_entries row (the mature stylist-fits-you-in pipeline: queue,
// badge, drag-to-calendar, convert), the family's preferred stylist is
// honored, dates are facility-tz correct, and the family gets a "we got it"
// email AND text immediately (P60) plus a confirmation when it's scheduled
// (P50-C4).
//
// Route path is kept — old clients and SW-cached portal pages keep working.

import { db } from '@/db'
import { facilities, residentPreferences, residents, services, signupSheetEntries } from '@/db/schema'
import { getPortalSession } from '@/lib/portal-auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { buildPortalRequestEmailHtml, buildRequestReceivedEmailHtml, sendEmail } from '@/lib/email'
import { buildRequestReceivedSms, sendSms } from '@/lib/sms'
import { getFamilyRecipients } from '@/lib/portal-recipients'
import { ensureSignupSheetSchema } from '@/lib/signup-sheet-ddl'
import { resolveAssignedStylist } from '@/lib/signup-sheet-assignment'
import { getFacilityWorkingDows } from '@/lib/facility-working-days'
import { formatWorkingDayNames, rangeHasWorkingDow } from '@/lib/working-days'
import { dayRangeInTimezone, formatDateInTz } from '@/lib/time'
import { appUrl } from '@/lib/app-url'
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

// P60 — human "when" for the SMS acknowledgement, rendered in the FACILITY
// timezone. The preferred dates are plain YYYY-MM-DD strings and
// `new Date('2026-09-08')` is UTC midnight, which formats as the PREVIOUS day
// anywhere west of UTC — dayRangeInTimezone resolves each date to its
// facility-local midnight instant first so the family is told the day they
// actually picked. weekday is explicitly cleared on range ends (Intl treats
// undefined as absent) so the whole text stays inside one SMS segment, and the
// range joiner is the ASCII word "to" — an en-dash is outside GSM-7 and would
// flip the message to UCS-2 (70 chars/segment, so ~3 segments and 3x cost).
const WHEN_DAY: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }
const WHEN_RANGE_END: Intl.DateTimeFormatOptions = { weekday: undefined, month: 'short', day: 'numeric' }

function formatWhenLabel(from: string | null, to: string | null, tz: string): string {
  const label = (dateStr: string, opts: Intl.DateTimeFormatOptions): string => {
    const range = dayRangeInTimezone(dateStr, tz)
    return range ? formatDateInTz(range.start, tz, opts) : dateStr
  }
  if (from && to && to !== from) return `${label(from, WHEN_RANGE_END)} to ${label(to, WHEN_RANGE_END)}`
  const single = from ?? to
  return single ? label(single, WHEN_DAY) : 'no date preference'
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

    // P55 — soft-validate the date window against real stylist working days
    // (only when availability data exists; empty = no restriction).
    if (preferredDateFrom && preferredDateTo) {
      const workingDows = await getFacilityWorkingDows(residentRow.facilityId)
      if (!rangeHasWorkingDow(preferredDateFrom, preferredDateTo, workingDows)) {
        return Response.json(
          {
            error: `The stylist isn't there on those dates — the stylist comes on ${formatWorkingDayNames(workingDows, 'en-US')}. Please pick dates that include one of those days.`,
          },
          { status: 422 },
        )
      }
    }
    const orderedSvcs = serviceIds
      .map((id) => svcRows.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s)

    // P60 — the family's contact set is resolved HERE, in the batch, not later
    // on the acknowledgement path: getFamilyRecipients is three lookups and two
    // of them re-read rows this same batch already has, so awaiting it further
    // down added three serialized round-trips through the max:1 pool to the
    // family's critical path.
    const [facility, residentDetail, prefs, family] = await Promise.all([
      db.query.facilities.findFirst({
        where: eq(facilities.id, residentRow.facilityId),
        columns: { id: true, name: true, contactEmail: true, timezone: true, isDemo: true },
      }),
      db.query.residents.findFirst({
        where: eq(residents.id, residentId),
        columns: { roomNumber: true },
      }),
      db.query.residentPreferences.findFirst({
        where: eq(residentPreferences.residentId, residentId),
        columns: { preferredStylistId: true },
      }).catch(() => null),
      getFamilyRecipients(residentId).catch(() => null),
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
          // APLEY — inherit the facility's flag instead of pinning `false`. A
          // request filed at a demo facility is demo data: it must be torn down
          // with the rest of the demo world, and it must not appear in a real
          // facility's queue or reporting. For every real facility this is
          // false, exactly as before.
          isDemo: facility?.isDemo ?? false,
        })
        .returning({ id: signupSheetEntries.id })
      entryId = created.id
    } catch (err) {
      console.error('[portal/request-booking] insert failed:', err)
      return Response.json({ error: 'Could not create request — please try again.' }, { status: 500 })
    }

    // Staff email (existing) + in-app bell for admins (P50).
    // P60 — appUrl() not a bare env read: with NEXT_PUBLIC_APP_URL unset this
    // built "/dashboard", an unclickable relative href in the staff email.
    const adminUrl = `${appUrl()}/dashboard`
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
        body: `${residentRow.residentName} — ${orderedSvcs.map((s) => s.name).join(', ')} (from the family)`,
        url: '/signup-sheet',
      }),
    ).catch(() => {})

    // Family confirmation — the requester's own email (P50: the requester is
    // often NOT the poaEmail on file). P55 — phone-only accounts have none.
    const facilityName = facility?.name ?? residentRow.facilityName
    if (session.email) {
      sendEmail({
        to: session.email,
        subject: `Request received — ${residentRow.residentName} at ${facilityName}`,
        html: buildRequestReceivedEmailHtml({
          residentName: residentRow.residentName,
          facilityName,
          serviceNames: orderedSvcs.map((s) => s.name),
          preferredDateFrom: preferredDateFrom ?? null,
          preferredDateTo: preferredDateTo ?? null,
        }),
      }).catch(() => {})
    }

    // P60 — SMS acknowledgement. The email above is the only ack this route
    // ever sent, so a phone-only family (P55 made phone a first-class portal
    // identity) tapped Request and got silence until a stylist scheduled it.
    // Gating mirrors family-confirmation.ts: the staff-side master switch
    // first, then the family's own sms_reminders preference. Recipients come
    // from the union resolver — the requester is often not the poaPhone.
    try {
      // `family` (resolved in the batch above) is named apart from the
      // staff-email `recipients` Set — these are the family's phones, not the
      // facility's inboxes.
      if (
        family &&
        family.poaNotificationsEnabled &&
        family.smsReminders &&
        family.phones.length > 0
      ) {
        // One SMS segment beats a full service list on a 6-service request.
        const serviceLabel =
          orderedSvcs.length > 1
            ? `${orderedSvcs[0].name} +${orderedSvcs.length - 1} more`
            : orderedSvcs[0].name
        const smsBody = buildRequestReceivedSms({
          facilityName,
          residentName: residentRow.residentName,
          serviceName: serviceLabel,
          whenLabel: formatWhenLabel(
            preferredDateFrom ?? null,
            preferredDateTo ?? null,
            facility?.timezone ?? 'America/New_York',
          ),
        })
        // Fire-and-forget: sendSms never throws and no-ops without Twilio.
        for (const phone of family.phones) sendSms(phone, smsBody).catch(() => {})
      }
    } catch (err) {
      // The request itself is already committed — a notification lookup
      // failure must never turn a saved request into a 500 for the family.
      console.error('[portal/request-booking] SMS acknowledgement failed:', err)
    }

    revalidateTag('signup-sheet', { expire: 0 })
    return Response.json({ data: { entryId } })
  } catch (err) {
    console.error('POST /api/portal/request-booking error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
