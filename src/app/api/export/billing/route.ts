import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, eq, gte, lt, ne } from 'drizzle-orm'
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
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return new Response('Unauthorized', { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return new Response('No facility', { status: 400 })
    const { facilityId } = facilityUser

    // ?month=2026-03  (defaults to current month)
    const monthParam = request.nextUrl.searchParams.get('month')
    let year: number
    let month: number // 0-based

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [y, m] = monthParam.split('-').map(Number)
      year = y
      month = m - 1
    } else {
      const now = new Date()
      year = now.getUTCFullYear()
      month = now.getUTCMonth()
    }

    const start = new Date(Date.UTC(year, month, 1))
    const end = new Date(Date.UTC(year, month + 1, 1))

    const start_label = start.toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })

    const rows = await db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityId),
        ne(bookings.status, 'cancelled'),
        ne(bookings.status, 'no_show'),
        gte(bookings.startTime, start),
        lt(bookings.startTime, end)
      ),
      with: {
        resident: true,
        stylist: true,
        service: true,
      },
      orderBy: (t, { asc }) => [asc(t.stylistId), asc(t.startTime)],
    })

    // Group by stylist
    const stylistGroups = new Map<string, typeof rows>()
    for (const b of rows) {
      const existing = stylistGroups.get(b.stylist.id)
      if (existing) {
        existing.push(b)
      } else {
        stylistGroups.set(b.stylist.id, [b])
      }
    }

    // Sort groups by stylist name
    const sortedGroups = Array.from(stylistGroups.entries()).sort(([, a], [, b]) =>
      a[0].stylist.name.localeCompare(b[0].stylist.name)
    )

    const lines: string[] = [
      `Billing Report — ${start_label}`,
      '',
      row(
        'Booking ID',
        'Date',
        'Resident',
        'Room',
        'Service',
        'Stylist',
        'Price',
        'Status',
        'Notes'
      ),
    ]

    let grandTotal = 0

    for (const [, groupRows] of sortedGroups) {
      const stylistName = groupRows[0].stylist.name

      for (const b of groupRows) {
        const date = new Date(b.startTime).toLocaleDateString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          timeZone: 'UTC',
        })
        const price = b.priceCents != null ? b.priceCents / 100 : (b.service?.priceCents ?? 0) / 100
        const bookingId = b.id.replace(/-/g, '').slice(0, 8).toUpperCase()

        lines.push(
          row(
            bookingId,
            date,
            b.resident.name,
            b.resident.roomNumber ?? '',
            b.service?.name ?? b.rawServiceName ?? 'Unknown service',
            b.stylist.name,
            price.toFixed(2),
            b.status,
            b.notes ?? ''
          )
        )
      }

      // price_cents only — never add tip_cents (tips go to stylist, not facility revenue)
      const subtotal = groupRows.reduce(
        (sum, b) => sum + (b.priceCents ?? b.service?.priceCents ?? 0),
        0
      )
      grandTotal += subtotal

      lines.push(
        row('', '', '', '', '', `${stylistName} SUBTOTAL`, (subtotal / 100).toFixed(2), '', '')
      )
      lines.push('')
    }

    lines.push(row('', '', '', '', '', 'GRAND TOTAL', (grandTotal / 100).toFixed(2), '', ''))

    const csv = lines.join('\r\n')
    const filename = `billing-${year}-${String(month + 1).padStart(2, '0')}.csv`

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('GET /api/export/billing error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}
