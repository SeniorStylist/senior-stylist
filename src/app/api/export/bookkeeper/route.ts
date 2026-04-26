import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities } from '@/db/schema'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { and, eq, gte, lt } from 'drizzle-orm'
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
    if (!canAccessBilling(facilityUser.role)) return new Response('Forbidden', { status: 403 })

    const { facilityId } = facilityUser

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

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
    })

    const tz = facility?.timezone ?? 'America/New_York'

    const rows = await db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.status, 'completed'),
        gte(bookings.startTime, start),
        lt(bookings.startTime, end)
      ),
      with: {
        resident: true,
        stylist: true,
        service: true,
      },
      orderBy: (t, { asc }) => [asc(t.startTime)],
    })

    const monthLabel = start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

    const lines: string[] = [
      `Bookkeeper Report — ${facility?.name ?? facilityId} — ${monthLabel}`,
      '',
      row('Date', 'Resident Name', 'Room #', 'Service', 'Stylist', 'Duration (min)', 'Price', 'Payment Status', 'Payment Method', 'Notes'),
    ]

    for (const b of rows) {
      const date = new Date(b.startTime).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        timeZone: tz,
      })
      const price = b.priceCents != null ? `$${(b.priceCents / 100).toFixed(2)}` : `$${(b.service.priceCents / 100).toFixed(2)}`

      lines.push(
        row(
          date,
          b.resident.name,
          b.resident.roomNumber ?? '',
          b.service.name,
          b.stylist.name,
          b.durationMinutes ?? b.service.durationMinutes,
          price,
          b.paymentStatus ?? '',
          b.resident.poaPaymentMethod ?? '',
          b.notes ?? ''
        )
      )
    }

    const csv = lines.join('\r\n')
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
    const filename = `bookkeeper-${monthStr}.csv`

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('GET /api/export/bookkeeper error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}
