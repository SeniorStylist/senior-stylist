import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  bookings,
  facilities,
  residents,
  stylists,
  services,
  stylistFacilityAssignments,
} from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { eq, and, gte, lte, lt, gt, or, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { isCalendarConfigured } from '@/lib/google-calendar/client'
import { createCalendarEvent } from '@/lib/google-calendar/sync'
import { createStylistCalendarEvent } from '@/lib/google-calendar/oauth-client'
import { Resend } from 'resend'
import { revalidateTag } from 'next/cache'
import { resolvePrice, validatePricingInput } from '@/lib/pricing'
import { sendEmail, buildBookingConfirmationEmailHtml } from '@/lib/email'
import { toClientJson } from '@/lib/sanitize'
import { resolveAvailableStylists, pickStylistWithLeastLoad } from '@/lib/portal-assignment'
import { isTutorialRequest } from '@/lib/help/tutorial-request'
import { getEffectiveStylistId } from '@/lib/effective-stylist'
import { bookingCreateSchema } from '@/lib/validation/booking-create'

// Phase 25 — schema lives in src/lib/validation/booking-create.ts so client
// payload builders can type against BookingCreateInput (drift = tsc error).
const createSchema = bookingCreateSchema

// P41 — a bare master admin has no facility_users row; they create bookings
// at ANY active facility via the body's facilityId (assistant cross-facility
// actions + master walk-ins). Non-masters: the body field is IGNORED.
function isMasterAdmin(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

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

    // is_demo filter — Phase 13. During a scripted tour the calendar shows ONLY
    // the demo booking (sandbox); normally it shows only real bookings.
    const conditions = [eq(bookings.facilityId, facilityId), eq(bookings.active, true), eq(bookings.isDemo, isTutorialRequest(request))]

    // P30 full lockdown — stylists read ONLY their own bookings (calendar,
    // dashboard, and any client fetch inherit this). Unlinked → empty list.
    if (facilityUser.role === 'stylist') {
      const ownId = await getEffectiveStylistId(user.id)
      if (!ownId) return Response.json({ data: [] })
      conditions.push(eq(bookings.stylistId, ownId))
    }

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
        importBatch: { columns: { fileName: true } },
      },
      orderBy: (t, { asc }) => [asc(t.startTime)],
      // Defensive cap — the calendar always passes start/end (a range never nears
      // this), but a param-less call must not dump a facility's full history.
      limit: 5000,
    })

    return Response.json({ data: toClientJson(data) })
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

    const master = isMasterAdmin(user.email)
    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser && !master) return Response.json({ error: 'No facility' }, { status: 400 })
    // Bookkeeper does manual log-sheet entry (the walk-in form) — same outcome as
    // the OCR import path they already use, so they may create bookings too.
    if (
      facilityUser &&
      !master &&
      !isAdminOrAbove(facilityUser.role) &&
      !isFacilityStaff(facilityUser.role) &&
      facilityUser.role !== 'stylist' &&
      facilityUser.role !== 'bookkeeper'
    ) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // P41 — master may target ANY active facility via body facilityId (the
    // assistant's cross-facility actions); non-masters: the field is IGNORED
    // and their own facility is authoritative.
    let facilityId: string
    const bodyFacilityId = master ? parsed.data.facilityId : undefined
    if (bodyFacilityId) {
      const target = await db.query.facilities.findFirst({
        where: and(eq(facilities.id, bodyFacilityId), eq(facilities.active, true)),
        columns: { id: true },
      })
      if (!target) return Response.json({ error: 'Facility not found' }, { status: 404 })
      facilityId = target.id
    } else if (facilityUser) {
      facilityId = facilityUser.facilityId
    } else {
      return Response.json({ error: 'No facility selected — include facilityId' }, { status: 400 })
    }

    const { stylistId, startTime: startTimeStr, notes } = parsed.data
    let residentId = parsed.data.residentId
    const isDemo = isTutorialRequest(request) // Phase 13 — tutorial-created booking

    // Normalize to an ordered list of primary service IDs (first = primary)
    const primaryServiceIds: string[] =
      parsed.data.serviceIds && parsed.data.serviceIds.length > 0
        ? parsed.data.serviceIds
        : parsed.data.serviceId
          ? [parsed.data.serviceId]
          : []
    if (primaryServiceIds.length === 0) {
      return Response.json({ error: 'serviceId or serviceIds is required' }, { status: 422 })
    }

    // Phase 18 — inline new-resident creation (offline walk-in replay). Guarded
    // by the same role check as the booking itself; facility-pinned; is_demo
    // follows the booking's tutorial tagging. Soft dedup: an existing active
    // resident with the same normalized name+room is reused instead of
    // duplicated (a queued write can replay after the same resident was
    // created online).
    let resident
    if (parsed.data.newResident) {
      const newName = parsed.data.newResident.name.trim()
      const newRoom = parsed.data.newResident.roomNumber?.trim() || null
      const roster = await db.query.residents.findMany({
        where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
        columns: { id: true, name: true, roomNumber: true },
      })
      const existing = roster.find(
        (r) =>
          r.name.trim().toLowerCase() === newName.toLowerCase() &&
          (r.roomNumber ?? '').trim().toLowerCase() === (newRoom ?? '').toLowerCase(),
      )
      if (existing) {
        residentId = existing.id
      } else {
        const [created] = await db
          .insert(residents)
          .values({ facilityId, name: newName, roomNumber: newRoom, isDemo })
          .returning()
        residentId = created.id
      }
      resident = await db.query.residents.findFirst({
        where: and(eq(residents.id, residentId!), eq(residents.facilityId, facilityId)),
      })
    } else {
      // Verify resident belongs to this facility
      resident = await db.query.residents.findFirst({
        where: and(eq(residents.id, residentId!), eq(residents.facilityId, facilityId)),
      })
    }
    if (!resident || !residentId) return Response.json({ error: 'Resident not found' }, { status: 404 })

    // Fetch all primary services in one query (single inArray, guarded .length > 0)
    const primarySvcRows = await db.query.services.findMany({
      where: and(eq(services.facilityId, facilityId), inArray(services.id, primaryServiceIds)),
    })
    if (primarySvcRows.length !== primaryServiceIds.length) {
      return Response.json({ error: 'One or more services not found' }, { status: 404 })
    }
    // Preserve caller-specified order
    const primaryServices = primaryServiceIds
      .map((id) => primarySvcRows.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s)
    const service = primaryServices[0] // primary = first

    // Resolve pricing for the PRIMARY (first) service using any quantity/option inputs.
    // Additional primary services resolve as fixed price (no per-service options in the current UI).
    const priceInput = {
      quantity: parsed.data.selectedQuantity,
      selectedOption: parsed.data.selectedOption,
      includeAddon: parsed.data.addonChecked,
    }
    const priceError = validatePricingInput(service, priceInput)
    if (priceError) {
      return Response.json({ error: priceError }, { status: 422 })
    }
    const { priceCents: primaryResolved, addonTotalCents } = resolvePrice(service, priceInput)
    // price_cents only — never add tip_cents (tips go to stylist, not facility revenue)
    const additionalPrimaryTotal = primaryServices
      .slice(1)
      .reduce((sum, s) => sum + resolvePrice(s).priceCents, 0)
    const resolvedPrice = primaryResolved + additionalPrimaryTotal

    // Resolve addon services (stacked addon-type services)
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

    // Total duration = sum of all primary services (addons never consume duration)
    const totalDurationMinutes = primaryServices.reduce((sum, s) => sum + s.durationMinutes, 0)

    const startTime = new Date(startTimeStr)
    const endTime = new Date(startTime.getTime() + totalDurationMinutes * 60000)

    // P30 — stylists may ONLY create bookings for THEMSELVES. Before this,
    // the create path accepted any stylistId from a stylist caller (edit and
    // delete checked ownership; create didn't — the UI lock was the only
    // barrier). Unlinked stylist accounts get a clear 403, not a silent fail.
    let ownStylistId: string | null = null
    if (facilityUser?.role === 'stylist') {
      ownStylistId = await getEffectiveStylistId(user.id)
      if (!ownStylistId) {
        return Response.json(
          { error: "Your account isn't linked to a stylist profile yet — ask your admin to link you in Settings → Team." },
          { status: 403 },
        )
      }
      if (stylistId && stylistId !== ownStylistId) {
        return Response.json(
          { error: 'Stylists can only create appointments for themselves.' },
          { status: 403 },
        )
      }
    }

    // Resolve stylist: either explicit (admin-edit / legacy callers) or auto-assigned via the
    // same helpers the resident portal uses, so admin and portal flows pick consistently.
    let resolvedStylistId: string
    if (facilityUser?.role === 'stylist') {
      resolvedStylistId = ownStylistId! // forced to self — never auto-assign for stylists
    } else if (stylistId) {
      resolvedStylistId = stylistId
    } else {
      const candidates = await resolveAvailableStylists({ facilityId, startTime, endTime, demoOnly: isDemo })
      if (candidates.length === 0) {
        return Response.json(
          { error: 'No stylist available for this date and time' },
          { status: 409 },
        )
      }
      // P36 — soft preference: when the family picked a preferred stylist and
      // they're among the available candidates, choose them (never exclusive —
      // unavailable preference falls through to least-loaded).
      let preferredPick: typeof candidates[number] | null = null
      if (residentId) {
        try {
          const { residentPreferences } = await import('@/db/schema')
          const pref = await db.query.residentPreferences.findFirst({
            where: eq(residentPreferences.residentId, residentId),
            columns: { preferredStylistId: true },
          })
          if (pref?.preferredStylistId) {
            preferredPick = candidates.find((c) => c.id === pref.preferredStylistId) ?? null
          }
        } catch { /* prefs table pre-migration — ignore */ }
      }
      const picked = preferredPick ?? await pickStylistWithLeastLoad(candidates, { facilityId, date: startTime })
      if (!picked) {
        return Response.json(
          { error: 'No stylist available for this date and time' },
          { status: 409 },
        )
      }
      resolvedStylistId = picked.id
    }

    // Verify resolved stylist is active and works this facility. P38 — accept
    // home rows OR active assignments (the canonical roster pattern; matches
    // /api/bookings/recurring). Assignment-only rejected home-row stylists a
    // manual pick legitimately offers.
    const stylist = await db.query.stylists.findFirst({
      where: and(
        eq(stylists.id, resolvedStylistId),
        eq(stylists.active, true),
        eq(stylists.status, 'active'),
      ),
    })
    if (!stylist) return Response.json({ error: 'Stylist not found' }, { status: 404 })

    if (stylist.facilityId !== facilityId) {
      const [assignment] = await db
        .select({ id: stylistFacilityAssignments.id })
        .from(stylistFacilityAssignments)
        .where(
          and(
            eq(stylistFacilityAssignments.stylistId, resolvedStylistId),
            eq(stylistFacilityAssignments.facilityId, facilityId),
            eq(stylistFacilityAssignments.active, true),
          ),
        )
        .limit(1)
      if (!assignment) {
        return Response.json(
          { error: 'Stylist is not assigned to this facility' },
          { status: 404 },
        )
      }
    }

    // Check for stylist conflict
    const conflict = await db.query.bookings.findFirst({
      where: and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.stylistId, resolvedStylistId),
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
        stylistId: resolvedStylistId,
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
        isDemo,
      })
      .returning()

    // ONE facility fetch serves GCal sync, push tz, confirmation-email tz, and the
    // POA email below (audit 2026-07: this row was fetched 4× per booking create).
    const facilityRow = isDemo
      ? null
      : await db.query.facilities.findFirst({ where: eq(facilities.id, facilityId) }).catch(() => null)
    const facilityTz = facilityRow?.timezone ?? 'America/New_York'

    // Attempt GCal sync — never for demo (tutorial) bookings
    try {
      if (!isDemo && isCalendarConfigured()) {
        const facility = facilityRow

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
      try {
        await db
          .update(bookings)
          .set({ syncError: errorMessage, updatedAt: new Date() })
          .where(eq(bookings.id, booking.id))
      } catch {
        // ignore — booking was created, just couldn't record sync error
      }
    }

    // Per-stylist calendar sync — fire-and-forget (skipped for demo bookings)
    if (!isDemo && stylist.googleRefreshToken && stylist.googleCalendarId) {
      createStylistCalendarEvent(stylist.googleRefreshToken, stylist.googleCalendarId, {
        id: booking.id,
        startTime: booking.startTime,
        endTime: booking.endTime,
        priceCents: booking.priceCents,
        notes: booking.notes,
        residentName: resident.name,
        stylistName: stylist.name,
        serviceName: service.name,
        servicePriceCents: service.priceCents,
        facilityId: booking.facilityId,
        residentId: booking.residentId,
        stylistId: booking.stylistId,
        serviceId: booking.serviceId ?? service.id,
      }).catch(err => console.error('Stylist calendar sync failed:', err))
    }

    // Notify stylist (push + inbox row) — fire-and-forget (skipped for demo bookings)
    if (!isDemo) {
      db.query.profiles.findFirst({ where: (p, { eq }) => eq(p.stylistId, stylist.id) })
        .then(async profile => {
          if (profile) {
            // W6: include the local date+time (facility tz) in the body
            const tz = facilityTz
            const when = booking.startTime.toLocaleString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz,
            })
            const { notifyUser } = await import('@/lib/notify')
            return notifyUser(profile.id, {
              type: 'booking_created',
              title: 'New booking',
              body: `${resident.name} — ${service.name} · ${when}`,
              url: '/dashboard',
              facilityId,
            })
          }
        })
        .catch(() => {})
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

    // Send confirmation email — fire-and-forget (skipped for demo bookings)
    try {
      const resendApiKey = process.env.RESEND_API_KEY
      const fromEmail = process.env.RESEND_FROM_EMAIL
      if (!isDemo && resendApiKey && fromEmail && user.email) {
        const resend = new Resend(resendApiKey)
        // Phase 12F — confirmation email shows facility-local time
        const tz = facilityTz
        const dateStr = startTime.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          timeZone: tz,
        })
        const timeStr = startTime.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: tz,
        })
        const priceStr = resolvedPrice
          ? `$${(resolvedPrice / 100).toFixed(2)}`
          : 'N/A'

        await resend.emails.send({
          from: fromEmail,
          to: user.email,
          subject: `Appointment booked — ${resident.name}`,
          html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#F5F5F4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#8B2E4A;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Appointment Booked</h1>
    </div>
    <div style="padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:38%;">Resident</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;font-weight:600;">${resident.name}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Service</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${service.name}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Date</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${dateStr}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Time</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${timeStr}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Stylist</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${stylist.name}</td></tr>
        <tr><td style="padding:10px 0;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Price</td><td style="padding:10px 0;color:#8B2E4A;font-size:14px;font-weight:700;">${priceStr}</td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:12px;color:#A8A29E;">Manage appointments at <a href="https://senior-stylist.vercel.app" style="color:#8B2E4A;text-decoration:none;">senior-stylist.vercel.app</a></p>
    </div>
  </div>
</body>
</html>
          `.trim(),
        })
      }
    } catch (emailErr) {
      console.error('Confirmation email failed (non-fatal):', emailErr)
    }

    // POA booking confirmation — fire-and-forget
    const poaEmail = data?.resident?.poaEmail
    if (poaEmail && data?.resident?.portalToken && data?.resident?.poaNotificationsEnabled !== false) {
      const facility = facilityRow
      const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL}/portal/${data.resident.portalToken}`
      const tz = facility?.timezone ?? 'America/New_York'
      const poaDateStr = startTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: tz })
      const poaTimeStr = startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })
      const poaPriceStr = resolvedPrice ? `$${(resolvedPrice / 100).toFixed(2)}` : 'N/A'
      const poaHtml = buildBookingConfirmationEmailHtml({
        residentName: data.resident.name,
        serviceName: data.service?.name ?? service.name,
        stylistName: data.stylist?.name ?? stylist.name,
        dateStr: poaDateStr,
        timeStr: poaTimeStr,
        priceStr: poaPriceStr,
        facilityName: facility?.name ?? 'Senior Stylist',
        portalUrl,
        bookedBy: 'staff',
      })
      sendEmail({ to: poaEmail, subject: `Appointment booked for ${data.resident.name}`, html: poaHtml }).catch(console.error)
    }

    revalidateTag('bookings', {})
    return Response.json({ data: toClientJson(data) }, { status: 201 })
  } catch (err) {
    console.error('POST /api/bookings error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
