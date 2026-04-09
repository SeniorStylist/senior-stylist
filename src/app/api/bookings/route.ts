import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities, residents, stylists, services } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and, gte, lte, lt, gt, or } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { isCalendarConfigured } from '@/lib/google-calendar/client'
import { createCalendarEvent } from '@/lib/google-calendar/sync'
import { Resend } from 'resend'
import { revalidateTag } from 'next/cache'
import { resolvePrice, validatePricingInput } from '@/lib/pricing'

const createSchema = z.object({
  residentId: z.string().uuid(),
  stylistId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startTime: z.string().datetime(),
  notes: z.string().optional(),
  selectedQuantity: z.number().int().min(1).optional(),
  selectedOption: z.string().optional(),
  addonChecked: z.boolean().optional(),
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

    // Resolve pricing
    const priceInput = {
      quantity: parsed.data.selectedQuantity,
      selectedOption: parsed.data.selectedOption,
      includeAddon: parsed.data.addonChecked,
    }
    const priceError = validatePricingInput(service, priceInput)
    if (priceError) {
      return Response.json({ error: priceError }, { status: 422 })
    }
    const { priceCents: resolvedPrice, addonTotalCents } = resolvePrice(service, priceInput)

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
        priceCents: resolvedPrice,
        durationMinutes: service.durationMinutes,
        notes: notes ?? null,
        selectedQuantity: parsed.data.selectedQuantity ?? null,
        selectedOption: parsed.data.selectedOption ?? null,
        addonTotalCents,
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
      try {
        await db
          .update(bookings)
          .set({ syncError: errorMessage, updatedAt: new Date() })
          .where(eq(bookings.id, booking.id))
      } catch {
        // ignore — booking was created, just couldn't record sync error
      }
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

    // Send confirmation email — fire-and-forget
    try {
      const resendApiKey = process.env.RESEND_API_KEY
      const fromEmail = process.env.RESEND_FROM_EMAIL
      if (resendApiKey && fromEmail && user.email) {
        const resend = new Resend(resendApiKey)
        const dateStr = startTime.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
        const timeStr = startTime.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
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
    <div style="background:#0D7377;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">Appointment Booked</h1>
    </div>
    <div style="padding:28px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:38%;">Resident</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;font-weight:600;">${resident.name}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Service</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${service.name}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Date</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${dateStr}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Time</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${timeStr}</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Stylist</td><td style="padding:10px 0;border-bottom:1px solid #F5F5F4;color:#1C1917;font-size:14px;">${stylist.name}</td></tr>
        <tr><td style="padding:10px 0;color:#78716C;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">Price</td><td style="padding:10px 0;color:#0D7377;font-size:14px;font-weight:700;">${priceStr}</td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:12px;color:#A8A29E;">Manage appointments at <a href="https://senior-stylist.vercel.app" style="color:#0D7377;text-decoration:none;">senior-stylist.vercel.app</a></p>
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

    revalidateTag('bookings', {})
    return Response.json({ data }, { status: 201 })
  } catch (err) {
    console.error('POST /api/bookings error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
