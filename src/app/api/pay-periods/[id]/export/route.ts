import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { payPeriods, facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

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

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function payTypeLabel(t: string): string {
  return t === 'commission' ? 'Commission' : t === 'hourly' ? 'Hourly' : 'Flat'
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return new Response('Unauthorized', { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return new Response('No facility', { status: 400 })
    if (facilityUser.role !== 'admin') return new Response('Forbidden', { status: 403 })

    const rl = await checkRateLimit('payrollExport', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const period = await db.query.payPeriods.findFirst({
      where: and(eq(payPeriods.id, id), eq(payPeriods.facilityId, facilityUser.facilityId)),
      with: {
        items: {
          with: { stylist: true, deductions: true },
        },
      },
    })
    if (!period) return new Response('Not found', { status: 404 })

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityUser.facilityId),
    })

    const items = [...period.items].sort((a, b) =>
      a.stylist.name.localeCompare(b.stylist.name),
    )

    const lines: string[] = [
      `Payroll Export — ${facility?.name ?? facilityUser.facilityId} — ${period.startDate} to ${period.endDate}`,
      '',
      row(
        'Stylist Name',
        'ST Code',
        'Facility',
        'Pay Type',
        'Gross Revenue',
        'Commission Rate',
        'Commission Amount',
        'Hours Worked',
        'Hourly Rate',
        'Flat Amount',
        'Deductions',
        'Net Pay',
        'Notes',
      ),
    ]

    for (const it of items) {
      const deductionsTotal = it.deductions.reduce((s, d) => s + d.amountCents, 0)
      lines.push(
        row(
          it.stylist.name,
          it.stylist.stylistCode,
          facility?.name ?? '',
          payTypeLabel(it.payType),
          dollars(it.grossRevenueCents),
          `${it.commissionRate}%`,
          dollars(it.commissionAmountCents),
          it.hoursWorked ?? '',
          it.hourlyRateCents != null ? dollars(it.hourlyRateCents) : '',
          it.flatAmountCents != null ? dollars(it.flatAmountCents) : '',
          dollars(deductionsTotal),
          dollars(it.netPayCents),
          it.notes ?? '',
        ),
      )
    }

    const totalNet = items.reduce((s, it) => s + it.netPayCents, 0)
    lines.push('')
    lines.push(row('', '', '', '', '', '', '', '', '', '', 'Total', dollars(totalNet), ''))

    const csv = lines.join('\r\n')
    const filename = `payroll-${period.startDate}-${period.endDate}.csv`

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('GET /api/pay-periods/[id]/export error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}
