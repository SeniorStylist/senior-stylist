import { db } from '@/db'
import { qbPayments, bookings, residents, facilities } from '@/db/schema'
import { and, eq, gte, lt, notInArray } from 'drizzle-orm'
import type { ReconciliationLine, ReconciliationStatus } from '@/types'
import { dayRangeInTimezone } from '@/lib/time'

const EXCLUDED_BOOKING_STATUSES = ['cancelled', 'no_show', 'requested']

interface ReconcileResult {
  status: Exclude<ReconciliationStatus, 'unreconciled'>
  lines: ReconciliationLine[]
  matchedCount: number
  unmatchedCount: number
  notes: string
}

async function findBookingForDate(
  facilityId: string,
  residentId: string,
  dateStr: string,
  timezone: string,
  dayShift: number,
) {
  const range = dayRangeInTimezone(dateStr, timezone, dayShift)
  if (!range) return null
  return db.query.bookings.findFirst({
    where: and(
      eq(bookings.facilityId, facilityId),
      eq(bookings.residentId, residentId),
      gte(bookings.startTime, range.start),
      lt(bookings.startTime, range.end),
      notInArray(bookings.status, EXCLUDED_BOOKING_STATUSES),
    ),
    columns: { id: true, startTime: true },
    with: { stylist: { columns: { name: true } } },
  })
}

function shiftDateString(dateStr: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return dateStr
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + days)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function bookingDateInTimezone(start: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(start) // en-CA renders as YYYY-MM-DD
}

export async function reconcilePayment(
  paymentId: string,
  facilityId: string,
): Promise<ReconcileResult> {
  const payment = await db.query.qbPayments.findFirst({
    where: and(eq(qbPayments.id, paymentId), eq(qbPayments.facilityId, facilityId)),
  })
  if (!payment) {
    throw new Error('Payment not found')
  }

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { timezone: true },
  })
  const tz = facility?.timezone ?? 'America/New_York'

  const bd = payment.residentBreakdown
  const isRemittance =
    bd && !Array.isArray(bd) && (bd as { type?: string }).type === 'remittance_lines'

  if (!isRemittance) {
    const notes = 'Non-remittance payment — no per-line reconciliation needed.'
    await db
      .update(qbPayments)
      .set({
        reconciliationStatus: 'reconciled',
        reconciledAt: new Date(),
        reconciliationNotes: notes,
        reconciliationLines: [],
      })
      .where(eq(qbPayments.id, paymentId))
    return { status: 'reconciled', lines: [], matchedCount: 0, unmatchedCount: 0, notes }
  }

  const remLines = (bd as { lines: Array<{ ref: string | null; invoiceDate: string | null; amountCents: number }> }).lines

  // Resolve resident: prefer payment.residentId; fall back to qb_invoices lookup by ref per-line.
  const baseResidentId = payment.residentId
  let baseResidentName = 'Unknown'
  if (baseResidentId) {
    const r = await db.query.residents.findFirst({
      where: eq(residents.id, baseResidentId),
      columns: { name: true },
    })
    baseResidentName = r?.name ?? 'Unknown'
  }

  const lines: ReconciliationLine[] = []

  for (const ln of remLines) {
    const residentId: string | null = baseResidentId
    const residentName = baseResidentName

    if (!residentId) {
      lines.push({
        invoiceRef: ln.ref,
        invoiceDate: ln.invoiceDate,
        residentId: null,
        residentName,
        amountCents: ln.amountCents,
        confidence: 'unmatched',
        logEntryId: null,
        logDate: null,
        logStylistName: null,
        flagReason: 'Resident not matched during scan',
      })
      continue
    }

    if (!ln.invoiceDate) {
      lines.push({
        invoiceRef: ln.ref,
        invoiceDate: null,
        residentId,
        residentName,
        amountCents: ln.amountCents,
        confidence: 'unmatched',
        logEntryId: null,
        logDate: null,
        logStylistName: null,
        flagReason: 'No invoice date on remittance line',
      })
      continue
    }

    // Try same-day, then -1, then +1
    let booking = await findBookingForDate(facilityId, residentId, ln.invoiceDate, tz, 0)
    let confidence: ReconciliationLine['confidence'] = 'high'
    let flagReason: string | null = null

    if (!booking) {
      booking = await findBookingForDate(facilityId, residentId, ln.invoiceDate, tz, -1)
      if (booking) {
        confidence = 'medium'
        flagReason = 'Date off by 1 day (booking found 1 day earlier)'
      }
    }
    if (!booking) {
      booking = await findBookingForDate(facilityId, residentId, ln.invoiceDate, tz, 1)
      if (booking) {
        confidence = 'medium'
        flagReason = 'Date off by 1 day (booking found 1 day later)'
      }
    }

    if (!booking) {
      lines.push({
        invoiceRef: ln.ref,
        invoiceDate: ln.invoiceDate,
        residentId,
        residentName,
        amountCents: ln.amountCents,
        confidence: 'unmatched',
        logEntryId: null,
        logDate: null,
        logStylistName: null,
        flagReason: 'No booking found for this resident on this date',
      })
      continue
    }

    lines.push({
      invoiceRef: ln.ref,
      invoiceDate: ln.invoiceDate,
      residentId,
      residentName,
      amountCents: ln.amountCents,
      confidence,
      logEntryId: booking.id,
      logDate: bookingDateInTimezone(booking.startTime as Date, tz),
      logStylistName: booking.stylist?.name ?? null,
      flagReason,
    })
  }

  const matchedCount = lines.filter((l) => l.confidence !== 'unmatched').length
  const unmatchedCount = lines.length - matchedCount
  const allHigh = lines.length > 0 && lines.every((l) => l.confidence === 'high')
  const anyUnmatched = lines.some((l) => l.confidence === 'unmatched')

  let status: ReconcileResult['status']
  if (anyUnmatched) status = 'flagged'
  else if (allHigh) status = 'reconciled'
  else status = 'partial'

  const notes =
    lines.length === 0
      ? 'No lines to reconcile.'
      : `${matchedCount}/${lines.length} matched${unmatchedCount > 0 ? `, ${unmatchedCount} flagged` : ''}`

  await db
    .update(qbPayments)
    .set({
      reconciliationStatus: status,
      reconciledAt: new Date(),
      reconciliationNotes: notes,
      reconciliationLines: lines,
    })
    .where(eq(qbPayments.id, paymentId))

  return { status, lines, matchedCount, unmatchedCount, notes }
}
