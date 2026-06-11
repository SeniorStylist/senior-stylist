import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities, profiles, services } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { sendEmail, buildDailyLogEmailHtml, type DailyLogEmailRow } from '@/lib/email'
import { formatTimeInTz } from '@/lib/time'
import { eq, and, gte, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const emailSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().email().max(320),
  message: z.string().max(500).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 })
    const { facilityId } = facilityUser

    const rl = await checkRateLimit('logEmail', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsed = emailSchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request' }, { status: 422 })
    }
    const { date, to, message } = parsed.data

    // Stylists only email their own day log
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { stylistId: true, fullName: true },
    })
    const stylistFilter = facilityUser.role === 'stylist' ? profile?.stylistId ?? null : null

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { name: true, timezone: true },
    })
    if (!facility) return Response.json({ error: 'Facility not found' }, { status: 404 })
    const tz = facility.timezone || 'America/New_York'

    // Same UTC-day window as GET /api/log
    const dayStart = new Date(date + 'T00:00:00.000Z')
    const dayEnd = new Date(date + 'T23:59:59.999Z')

    const [dayBookings, facilityServices] = await Promise.all([
      db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facilityId),
          eq(bookings.active, true),
          eq(bookings.isDemo, false), // is_demo filter — Phase 13 (never email demo data)
          ne(bookings.status, 'cancelled'),
          gte(bookings.startTime, dayStart),
          lt(bookings.startTime, dayEnd),
          ...(stylistFilter ? [eq(bookings.stylistId, stylistFilter)] : []),
        ),
        with: {
          resident: { columns: { name: true, roomNumber: true } },
          stylist: { columns: { id: true, name: true } },
          service: { columns: { name: true } },
        },
        orderBy: (t, { asc }) => [asc(t.startTime)],
      }),
      db.query.services.findMany({
        where: eq(services.facilityId, facilityId),
        columns: { id: true, name: true },
      }),
    ])

    const serviceNameById = new Map(facilityServices.map((s) => [s.id, s.name]))

    // Group rows by stylist, preserving time order
    const groupMap = new Map<string, { stylistName: string; rows: DailyLogEmailRow[] }>()
    for (const b of dayBookings) {
      const primaryNames =
        b.serviceNames && b.serviceNames.length > 0
          ? b.serviceNames
          : b.service
            ? [b.service.name]
            : b.rawServiceName
              ? [b.rawServiceName]
              : ['Unknown service']
      const addonNames = (b.addonServiceIds ?? [])
        .map((id) => serviceNameById.get(id))
        .filter((n): n is string => Boolean(n))
      const key = b.stylist?.id ?? 'unassigned'
      if (!groupMap.has(key)) {
        groupMap.set(key, { stylistName: b.stylist?.name ?? 'Unassigned', rows: [] })
      }
      groupMap.get(key)!.rows.push({
        time: formatTimeInTz(b.startTime, tz),
        residentName: b.resident?.name ?? 'Unknown resident',
        roomNumber: b.resident?.roomNumber ?? null,
        serviceLabel: [...primaryNames, ...addonNames].join(' + '),
        // price_cents only — never add tip_cents
        priceCents: (b.priceCents ?? 0) + (b.addonTotalCents ?? 0),
        tipCents: b.tipCents ?? null,
        status: b.status,
        paymentStatus: b.paymentStatus ?? null,
        notes: b.notes ?? null,
      })
    }

    const dateLabel = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })

    const html = buildDailyLogEmailHtml({
      facilityName: facility.name,
      dateLabel,
      sentByName: profile?.fullName ?? user.email ?? 'Senior Stylist',
      message: message ?? null,
      groups: [...groupMap.values()],
    })

    // fire-and-forget per email convention
    sendEmail({
      to,
      subject: `Daily Service Log — ${facility.name} — ${dateLabel}`,
      html,
    }).catch(() => {})

    return Response.json({ data: { sent: true, count: dayBookings.length } })
  } catch (err) {
    console.error('POST /api/log/email error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
