// Memo dissection — turn free-text check memos like
// "Payment for 05/26/26 Jean Hall $48 Alma Markley $48 ..." into per-resident
// attributions. GET previews (parse + fuzzy resident match + unpaid-booking
// candidates); POST applies operator-confirmed lines: flips the bookings to
// paid with a "Paid via check #N" note and stores the breakdown on the payment.
// Preview/confirm contract — the server NEVER auto-applies fuzzy matches.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { qbPayments, residents, facilities, bookings } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { parseMemo } from '@/lib/memo-attribution'
import { fuzzyScore } from '@/lib/fuzzy'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const applySchema = z.object({
  lines: z
    .array(
      z.object({
        rawName: z.string().max(200),
        residentId: z.string().uuid(),
        amountCents: z.number().int().min(0).max(10_000_000),
        bookingId: z.string().uuid().nullable(),
      })
    )
    .min(1)
    .max(30),
})

async function authorize(paymentId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  let callerFacilityId: string | null = null
  let callerRole: string | null = null
  if (!isMaster) {
    const fu = await getUserFacility(user.id)
    if (!fu || !canAccessBilling(fu.role)) {
      return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
    }
    callerFacilityId = fu.facilityId
    callerRole = fu.role
  }

  const payment = await db.query.qbPayments.findFirst({
    where: eq(qbPayments.id, paymentId),
    columns: {
      id: true,
      facilityId: true,
      memo: true,
      amountCents: true,
      checkNum: true,
      paymentDate: true,
      residentBreakdown: true,
    },
  })
  // 404 (not 403) on cross-facility to avoid leaking payment existence
  if (!payment) return { error: Response.json({ error: 'Not found' }, { status: 404 }) }
  if (!isMaster && callerRole !== 'bookkeeper' && payment.facilityId !== callerFacilityId) {
    return { error: Response.json({ error: 'Not found' }, { status: 404 }) }
  }
  if (!payment.memo) {
    return { error: Response.json({ error: 'Payment has no memo' }, { status: 409 }) }
  }
  // Never clobber remittance_lines or scan-generated breakdowns
  const bd = payment.residentBreakdown
  if (bd && (!Array.isArray(bd) || bd.length > 0)) {
    return {
      error: Response.json(
        { error: 'Payment already has a resident breakdown' },
        { status: 409 }
      ),
    }
  }
  return { payment }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const { paymentId } = await params
  if (!UUID_RE.test(paymentId)) {
    return Response.json({ error: 'Invalid paymentId' }, { status: 400 })
  }

  try {
    const auth = await authorize(paymentId)
    if ('error' in auth) return auth.error
    const { payment } = auth

    const parsed = parseMemo(payment.memo!, payment.amountCents)
    if (parsed.lines.length === 0) {
      return Response.json({ data: { serviceDate: parsed.serviceDate, lines: [] } })
    }

    const [facility, residentList] = await Promise.all([
      db.query.facilities.findFirst({
        where: eq(facilities.id, payment.facilityId),
        columns: { id: true, timezone: true },
      }),
      db.query.residents.findMany({
        where: and(
          eq(residents.facilityId, payment.facilityId),
          eq(residents.active, true),
          eq(residents.isDemo, false) // is_demo filter — Phase 13
        ),
        columns: { id: true, name: true, roomNumber: true },
      }),
    ])
    const tz = facility?.timezone ?? 'America/New_York'

    // Fuzzy-match each parsed name to a resident
    const matched = parsed.lines.map((line) => {
      let best: { id: string; name: string; roomNumber: string | null } | null = null
      let bestScore = 0
      for (const r of residentList) {
        const score = fuzzyScore(line.rawName, r.name)
        if (score > bestScore) {
          bestScore = score
          best = r
        }
      }
      if (bestScore < 0.7) best = null
      const confidence: 'high' | 'medium' | 'low' =
        bestScore >= 1 ? 'high' : bestScore >= 0.85 ? 'medium' : 'low'
      return { line, resident: best, confidence }
    })

    // One query for unpaid completed bookings of all matched residents within
    // ±60 days of the memo date (falling back to the payment date).
    const residentIds = [...new Set(matched.filter((m) => m.resident).map((m) => m.resident!.id))]
    interface CandidateRow {
      id: string
      resident_id: string
      d: string
      service_label: string | null
      total: unknown
    }
    let candidates: CandidateRow[] = []
    if (residentIds.length > 0) {
      const center = parsed.serviceDate ?? payment.paymentDate
      // price_cents only — never add tip_cents
      const rows = await db.execute(sql`
        SELECT b.id, b.resident_id, to_char(b.start_time AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d,
               COALESCE(NULLIF(array_to_string(b.service_names, ' + '), ''), s.name, b.raw_service_name) AS service_label,
               (b.price_cents + COALESCE(b.addon_total_cents, 0)) AS total
        FROM bookings b
        LEFT JOIN services s ON s.id = b.service_id
        WHERE b.facility_id = ${payment.facilityId}
          AND b.resident_id IN (${sql.join(residentIds.map((id) => sql`${id}`), sql`, `)})
          AND b.status = 'completed' AND b.active = true AND b.is_demo = false
          AND b.payment_status = 'unpaid'
          AND b.start_time >= (${center}::date - INTERVAL '60 days')
          AND b.start_time < (${center}::date + INTERVAL '61 days')
        ORDER BY b.start_time ASC
        LIMIT 500
      `)
      candidates = rows as unknown as CandidateRow[]
    }

    // Per line: exact memo-date match first, else closest date. Claim-once.
    const claimed = new Set<string>()
    const targetDate = parsed.serviceDate ?? payment.paymentDate
    const targetMs = new Date(targetDate + 'T00:00:00Z').getTime()
    const lines = matched.map(({ line, resident, confidence }) => {
      let booking: CandidateRow | null = null
      if (resident) {
        const pool = candidates.filter((c) => c.resident_id === resident.id && !claimed.has(c.id))
        booking =
          pool.find((c) => parsed.serviceDate && c.d === parsed.serviceDate) ??
          pool.reduce<CandidateRow | null>((best, c) => {
            if (!best) return c
            const dc = Math.abs(new Date(c.d + 'T00:00:00Z').getTime() - targetMs)
            const db_ = Math.abs(new Date(best.d + 'T00:00:00Z').getTime() - targetMs)
            return dc < db_ ? c : best
          }, null)
        if (booking) claimed.add(booking.id)
      }
      return {
        rawName: line.rawName,
        amountCents: line.amountCents,
        residentId: resident?.id ?? null,
        residentName: resident?.name ?? null,
        roomNumber: resident?.roomNumber ?? null,
        confidence: resident ? confidence : null,
        booking: booking
          ? {
              id: booking.id,
              dateStr: booking.d,
              serviceLabel: booking.service_label ?? 'Service',
              totalCents: Number(booking.total ?? 0) || 0,
            }
          : null,
      }
    })

    return Response.json({
      data: {
        serviceDate: parsed.serviceDate,
        checkNum: payment.checkNum,
        checkAmountCents: payment.amountCents,
        lines,
      },
    })
  } catch (err) {
    console.error('[billing/memo-match] GET error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  const { paymentId } = await params
  if (!UUID_RE.test(paymentId)) {
    return Response.json({ error: 'Invalid paymentId' }, { status: 400 })
  }

  try {
    const auth = await authorize(paymentId)
    if ('error' in auth) return auth.error
    const { payment } = auth

    const body = applySchema.safeParse(await req.json())
    if (!body.success) {
      return Response.json({ error: 'Invalid body' }, { status: 400 })
    }
    const { lines } = body.data

    // Re-validate everything server-side — never trust client scoping.
    const residentIds = [...new Set(lines.map((l) => l.residentId))]
    const bookingIds = lines.map((l) => l.bookingId).filter((id): id is string => !!id)
    if (new Set(bookingIds).size !== bookingIds.length) {
      return Response.json({ error: 'Duplicate bookings in request' }, { status: 400 })
    }

    const [validResidents, validBookings] = await Promise.all([
      db.query.residents.findMany({
        where: and(
          eq(residents.facilityId, payment.facilityId),
          eq(residents.active, true)
        ),
        columns: { id: true },
      }),
      bookingIds.length > 0
        ? db.query.bookings.findMany({
            where: and(
              eq(bookings.facilityId, payment.facilityId),
              eq(bookings.status, 'completed'),
              eq(bookings.active, true),
              eq(bookings.paymentStatus, 'unpaid')
            ),
            columns: { id: true, residentId: true, notes: true },
          })
        : Promise.resolve([]),
    ])
    const residentSet = new Set(validResidents.map((r) => r.id))
    const bookingMap = new Map(validBookings.map((b) => [b.id, b]))

    for (const line of lines) {
      if (!residentSet.has(line.residentId)) {
        return Response.json({ error: 'Resident not in this facility' }, { status: 422 })
      }
      if (line.bookingId) {
        const b = bookingMap.get(line.bookingId)
        if (!b || b.residentId !== line.residentId) {
          return Response.json(
            { error: 'A selected booking is no longer unpaid — refresh and retry' },
            { status: 422 }
          )
        }
      }
    }

    const breakdown = lines.map((l) => ({
      name: l.rawName,
      residentId: l.residentId,
      amountCents: l.amountCents,
      matchConfidence: 'high' as const, // operator-confirmed
    }))

    await db.transaction(async (tx) => {
      for (const line of lines) {
        if (!line.bookingId) continue
        const existing = bookingMap.get(line.bookingId)!
        const dollars = (line.amountCents / 100).toFixed(2)
        const note = payment.checkNum
          ? `Paid via check #${payment.checkNum} ($${dollars})`
          : `Paid via check ($${dollars})`
        const newNotes = (existing.notes ? `${existing.notes}\n${note}` : note).slice(0, 2000)
        await tx
          .update(bookings)
          .set({ paymentStatus: 'paid', notes: newNotes })
          .where(eq(bookings.id, line.bookingId))
      }
      await tx
        .update(qbPayments)
        .set({ residentBreakdown: breakdown })
        .where(eq(qbPayments.id, payment.id))
    })

    revalidateTag('billing', {})
    revalidateTag('bookings', {})

    return Response.json({
      data: { applied: lines.filter((l) => l.bookingId).length, breakdown },
    })
  } catch (err) {
    console.error('[billing/memo-match] POST error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
