import { NextRequest } from 'next/server'
import { z } from 'zod'
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, facilities, facilityUsers, profiles } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { dayRangeInTimezone, getLocalParts } from '@/lib/time'
import {
  facilityLabel,
  stylistLabel,
  formatServices,
  paymentTypeLabel,
  dollarsNumber,
  tipsCell,
  notesCell,
  roomCell,
  NOT_FILLED,
} from '@/lib/exports/daily-log-format'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const querySchema = z.object({
  facilityIds: z
    .string()
    .min(1)
    .transform((s) => s.split(',').map((id) => id.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(50)),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mailSubject: z.string().max(200).optional(),
})

const HEADERS = [
  'No.',
  'Mail Subject',
  'Mail date',
  'Mail Time',
  'Service Date',
  'Facility Name',
  'Stylist Name',
  'Client Name',
  'Room#',
  'Services Performed',
  'Amount',
  'Notes',
  'Tips',
  'Payment Type',
]

const COLUMN_DEFS = [
  { key: 'no', width: 5 },
  { key: 'mailSubject', width: 22 },
  { key: 'mailDate', width: 11.33 },
  { key: 'mailTime', width: 9.66 },
  { key: 'serviceDate', width: 12.89 },
  { key: 'facility', width: 26.66 },
  { key: 'stylist', width: 20.55 },
  { key: 'client', width: 22.44 },
  { key: 'room', width: 8 },
  { key: 'services', width: 32 },
  { key: 'amount', width: 10 },
  { key: 'notes', width: 24 },
  { key: 'tips', width: 8 },
  { key: 'paymentType', width: 14.22 },
]

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDateInTz(date: Date, tz: string): string {
  const p = getLocalParts(date, tz)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

function formatMailDate(date: Date, tz: string): string {
  const p = getLocalParts(date, tz)
  return `${p.month}/${p.day}/${p.year}`
}

function formatMailTime(date: Date, tz: string): string {
  const p = getLocalParts(date, tz)
  const period = p.hours >= 12 ? 'PM' : 'AM'
  const h12 = p.hours % 12 === 0 ? 12 : p.hours % 12
  return `${h12}:${pad2(p.minutes)} ${period}`
}

function diffDays(startDate: string, endDate: string): number {
  const start = Date.UTC(
    Number(startDate.slice(0, 4)),
    Number(startDate.slice(5, 7)) - 1,
    Number(startDate.slice(8, 10)),
  )
  const end = Date.UTC(
    Number(endDate.slice(0, 4)),
    Number(endDate.slice(5, 7)) - 1,
    Number(endDate.slice(8, 10)),
  )
  return Math.round((end - start) / 86_400_000)
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return new Response('Unauthorized', { status: 401 })

    const url = new URL(request.url)
    const parsed = querySchema.safeParse({
      facilityIds: url.searchParams.get('facilityIds') ?? '',
      startDate: url.searchParams.get('startDate') ?? '',
      endDate: url.searchParams.get('endDate') ?? '',
      mailSubject: url.searchParams.get('mailSubject') ?? undefined,
    })
    if (!parsed.success) {
      return Response.json({ error: 'Invalid query params' }, { status: 400 })
    }
    const { facilityIds, startDate, endDate, mailSubject } = parsed.data

    const days = diffDays(startDate, endDate)
    if (days < 0) {
      return Response.json({ error: 'endDate must be on or after startDate' }, { status: 400 })
    }
    if (days > 366) {
      return Response.json({ error: 'Range exceeds 366 days' }, { status: 400 })
    }

    const rl = await checkRateLimit('exportExcel', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    // Scope facilities + stylist
    let allowedFacilityIds: Set<string>
    let stylistScopeId: string | null = null

    if (isMaster) {
      allowedFacilityIds = new Set(facilityIds)
    } else {
      const facilityUser = await getUserFacility(user.id)
      if (!facilityUser) return new Response('No facility', { status: 400 })

      if (facilityUser.role === 'stylist') {
        const prof = await db.query.profiles.findFirst({
          where: eq(profiles.id, user.id),
          columns: { stylistId: true },
        })
        if (!prof?.stylistId) return new Response('Not linked to a stylist', { status: 400 })
        stylistScopeId = prof.stylistId
        allowedFacilityIds = new Set([facilityUser.facilityId])
      } else if (facilityUser.role === 'bookkeeper') {
        // Bookkeepers are cross-facility by role (they hold only one anchor
        // facility_users row) — grant export access to every active facility,
        // mirroring billing/analytics. Without this they could only export their
        // anchor facility and any other facility returned an empty/forbidden file.
        const active = await db.query.facilities.findMany({
          where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
          columns: { id: true },
        })
        allowedFacilityIds = new Set(active.map((f) => f.id))
      } else {
        const memberships = await db.query.facilityUsers.findMany({
          where: eq(facilityUsers.userId, user.id),
          columns: { facilityId: true },
        })
        allowedFacilityIds = new Set(memberships.map((m) => m.facilityId))
      }

      const denied = facilityIds.filter((id) => !allowedFacilityIds.has(id))
      if (denied.length > 0) {
        return Response.json({ error: 'Forbidden facility access' }, { status: 403 })
      }
    }

    const targetFacilityIds = facilityIds.filter((id) => allowedFacilityIds.has(id))
    if (targetFacilityIds.length === 0) {
      return Response.json({ error: 'No accessible facilities' }, { status: 400 })
    }

    // Fetch facility tz/code/name for each selected facility
    const facilityRows = await db.query.facilities.findMany({
      where: inArray(facilities.id, targetFacilityIds),
      columns: { id: true, name: true, facilityCode: true, timezone: true },
    })
    const facilityMap = new Map(facilityRows.map((f) => [f.id, f]))

    // Compute widest UTC range across all facility tzs
    let minStartUtc: Date | null = null
    let maxEndUtc: Date | null = null
    for (const fac of facilityRows) {
      const range = dayRangeInTimezone(startDate, fac.timezone)
      const endRange = dayRangeInTimezone(endDate, fac.timezone)
      if (!range || !endRange) continue
      if (!minStartUtc || range.start < minStartUtc) minStartUtc = range.start
      if (!maxEndUtc || endRange.end > maxEndUtc) maxEndUtc = endRange.end
    }
    if (!minStartUtc || !maxEndUtc) {
      return Response.json({ error: 'Invalid date range' }, { status: 400 })
    }

    const whereParts = [
      inArray(bookings.facilityId, targetFacilityIds),
      eq(bookings.active, true),
      eq(bookings.isDemo, false), // is_demo filter — Phase 13
      eq(bookings.status, 'completed'),
      gte(bookings.startTime, minStartUtc),
      lt(bookings.startTime, maxEndUtc),
    ]
    if (stylistScopeId) {
      whereParts.push(eq(bookings.stylistId, stylistScopeId))
    }

    const rows = await db.query.bookings.findMany({
      where: and(...whereParts),
      with: {
        facility: { columns: { id: true, name: true, facilityCode: true, timezone: true } },
        stylist: { columns: { id: true, name: true, stylistCode: true } },
        resident: { columns: { id: true, name: true, roomNumber: true } },
        service: { columns: { name: true } },
      },
      orderBy: [asc(bookings.startTime)],
    })

    // Per-facility-tz filter (excludes rows that fell in the over-fetch window
    // but aren't actually in the requested [startDate, endDate] day-range for
    // their own facility's timezone)
    const exportRows = rows.filter((b) => {
      const tz = b.facility?.timezone ?? 'America/New_York'
      const iso = isoDateInTz(b.startTime as Date, tz)
      return iso >= startDate && iso <= endDate
    })

    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Daily Log')
    ws.columns = COLUMN_DEFS.map((c) => ({ key: c.key, width: c.width }))

    const headerRow = ws.addRow(HEADERS)
    headerRow.eachCell((cell, colNumber) => {
      cell.font = {
        name: 'Calibri',
        bold: ![2, 3, 4].includes(colNumber), // B, C, D NOT bold per sample
      }
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFF00' },
      }
    })

    // Use first facility's tz (or NY) for the generated-at "Mail" columns
    const mailTz = facilityRows[0]?.timezone ?? 'America/New_York'
    const generatedAt = new Date()
    const mailDate = formatMailDate(generatedAt, mailTz)
    const mailTime = formatMailTime(generatedAt, mailTz)

    exportRows.forEach((b, i) => {
      const fac = b.facility
      const tz = fac?.timezone ?? mailTz
      const serviceNames =
        b.serviceNames && b.serviceNames.length > 0
          ? b.serviceNames
          : b.service?.name
            ? [b.service.name]
            : []

      ws.addRow({
        no: i + 1,
        // Per-sheet subject entered at scan time wins; the export-modal subject
        // is the fallback for rows scanned without one.
        mailSubject: b.mailSubject?.trim() || mailSubject || 'Senior Stylist Export',
        mailDate,
        mailTime,
        serviceDate: fac ? formatMailDate(b.startTime as Date, tz) : NOT_FILLED,
        facility: fac ? facilityLabel(fac.facilityCode, fac.name) : NOT_FILLED,
        stylist: b.stylist ? stylistLabel(b.stylist.stylistCode, b.stylist.name) : NOT_FILLED,
        client: b.resident?.name ?? NOT_FILLED,
        room: roomCell(b.resident?.roomNumber),
        services: formatServices(serviceNames),
        amount: dollarsNumber((b.priceCents ?? 0) + (b.addonTotalCents ?? 0)),
        notes: notesCell(b.notes),
        tips: tipsCell(b.tipCents),
        paymentType: paymentTypeLabel(b.paymentStatus, b.paymentMethod),
      })
    })

    const buf = await wb.xlsx.writeBuffer()

    // Filename
    let fileLabel: string
    if (targetFacilityIds.length === 1) {
      const fac = facilityMap.get(targetFacilityIds[0])
      fileLabel = (fac?.facilityCode || fac?.name || 'export').replace(/[^a-zA-Z0-9_-]/g, '_')
    } else {
      fileLabel = 'multi-facility'
    }
    const filename = `${fileLabel}_${startDate}_to_${endDate}.xlsx`

    return new Response(buf, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('GET /api/exports/daily-logs error:', err)
    return new Response('Internal server error', { status: 500 })
  }
}
