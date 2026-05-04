import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { sendEmail, buildBookingReceiptHtml } from '@/lib/email'
import { sendSms, buildReceiptSms } from '@/lib/sms'

export const dynamic = 'force-dynamic'

function formatServiceDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('receiptSend', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const isMaster = user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const whereClause = isMaster
      ? eq(bookings.id, id)
      : and(eq(bookings.id, id), eq(bookings.facilityId, facilityUser.facilityId))

    const booking = await db.query.bookings.findFirst({
      where: whereClause,
      with: {
        resident: { columns: { id: true, name: true, poaEmail: true, poaPhone: true } },
        stylist: { columns: { id: true, name: true } },
        service: { columns: { id: true, name: true } },
        facility: { columns: { id: true, name: true, address: true, phone: true } },
      },
    })

    if (!booking) return Response.json({ error: 'Not found' }, { status: 404 })

    const data = {
      facilityName: booking.facility.name,
      facilityAddress: booking.facility.address,
      facilityPhone: booking.facility.phone,
      residentName: booking.resident.name,
      serviceName: booking.service?.name ?? booking.rawServiceName ?? 'Service',
      stylistName: booking.stylist.name,
      serviceDate: formatServiceDate(new Date(booking.startTime)),
      priceCents: booking.priceCents ?? 0,
      tipCents: booking.tipCents,
      paymentType: booking.paymentStatus === 'paid' ? 'Paid' : null,
    }

    let emailSent = false
    let smsSent = false

    if (booking.resident.poaEmail) {
      // Fire-and-forget per email convention
      void sendEmail({
        to: booking.resident.poaEmail,
        subject: `Receipt — ${booking.facility.name}`,
        html: buildBookingReceiptHtml(data),
      })
      emailSent = true
    }

    if (booking.resident.poaPhone && process.env.TWILIO_ENABLED === 'true') {
      void sendSms(booking.resident.poaPhone, buildReceiptSms(data))
      smsSent = true
    }

    return Response.json({ data: { emailSent, smsSent } })
  } catch (err) {
    console.error('POST /api/bookings/[id]/receipt error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
