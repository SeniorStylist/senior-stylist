export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities } from '@/db/schema'
import { and, eq, gte, lt, inArray, ne, asc } from 'drizzle-orm'
import { getSuperAdminFacilities } from '@/lib/get-super-admin-facilities'
import { NextRequest } from 'next/server'

function escapeCsv(value: string | number | null | undefined): string {
  const s = String(value ?? '')
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function row(...cells: (string | number | null | undefined)[]): string {
  return cells.map(escapeCsv).join(',')
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new Response('Unauthorized', { status: 401 })

    const facilityIds = await getSuperAdminFacilities(user.id, user.email ?? '')
    if (facilityIds.length === 0) return new Response('Forbidden', { status: 403 })

    const monthParam = request.nextUrl.searchParams.get('month') ?? ''
    let y: number, m: number
    if (/^\d{4}-\d{2}$/.test(monthParam)) {
      ;[y, m] = monthParam.split('-').map(Number)
    } else {
      y = new Date().getUTCFullYear()
      m = new Date().getUTCMonth() + 1
    }
    const start = new Date(Date.UTC(y, m - 1, 1))
    const end = new Date(Date.UTC(y, m, 1))
    const startLabel = start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

    const facilitiesList = await db
      .select({ id: facilities.id, name: facilities.name })
      .from(facilities)
      .where(inArray(facilities.id, facilityIds))

    const lines: string[] = [
      `Cross-Facility Billing Report — ${startLabel}`,
      '',
      row('Facility', 'Booking ID', 'Date', 'Resident', 'Room', 'Service', 'Stylist', 'Price', 'Payment Status', 'Notes'),
    ]

    let grandTotal = 0

    for (const facility of facilitiesList) {
      const rows = await db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facility.id),
          ne(bookings.status, 'cancelled'),
          ne(bookings.status, 'no_show'),
          gte(bookings.startTime, start),
          lt(bookings.startTime, end)
        ),
        with: { resident: true, stylist: true, service: true },
        orderBy: (t, { asc: a }) => [a(t.stylistId), a(t.startTime)],
      })

      if (rows.length === 0) continue

      let facilityTotal = 0
      for (const b of rows) {
        const date = new Date(b.startTime).toLocaleDateString('en-US', {
          month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC',
        })
        const price = (b.priceCents ?? b.service?.priceCents ?? 0) / 100
        const bookingId = b.id.replace(/-/g, '').slice(0, 8).toUpperCase()
        facilityTotal += b.priceCents ?? b.service?.priceCents ?? 0
        lines.push(row(
          facility.name,
          bookingId,
          date,
          b.resident.name,
          b.resident.roomNumber ?? '',
          b.service?.name ?? b.rawServiceName ?? 'Unknown service',
          b.stylist.name,
          price.toFixed(2),
          b.paymentStatus,
          b.notes ?? ''
        ))
      }

      grandTotal += facilityTotal
      lines.push(row(
        `${facility.name} SUBTOTAL`, '', '', '', '', '', '',
        (facilityTotal / 100).toFixed(2), '', ''
      ))
      lines.push('')
    }

    lines.push(row('GRAND TOTAL', '', '', '', '', '', '', (grandTotal / 100).toFixed(2), '', ''))

    const csv = lines.join('\r\n')
    const filename = `cross-facility-billing-${y}-${String(m).padStart(2, '0')}.csv`

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('GET /api/super-admin/export/billing error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}
