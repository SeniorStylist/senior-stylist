// Batch memo scan — previews per-resident attributions for ALL unmatched
// memo payments in a facility. Uses Gemini AI (single call for all memos)
// with heuristic fallback to parse; operator reviews and applies individually
// via POST /api/billing/memo-match/[paymentId].

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { residents, facilities } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { parseMemo, ParsedMemo } from '@/lib/memo-attribution'
import { fuzzyScore } from '@/lib/fuzzy'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const maxDuration = 60

const bodySchema = z.object({
  facilityId: z.string().uuid(),
})

interface RawPayment {
  id: string
  facility_id: string
  memo: string
  amount_cents: number | string
  check_num: string | null
  payment_date: string
}

interface GeminiLineResult {
  id: string
  serviceDate: string | null
  lines: Array<{ name: string; amountCents: number | null }>
}

// Single Gemini call for all memos — much more efficient than N individual calls.
async function geminiParseMemosBatch(
  payments: RawPayment[]
): Promise<Map<string, ParsedMemo>> {
  const apiKey = process.env.GEMINI_API_KEY
  const result = new Map<string, ParsedMemo>()
  if (!apiKey || payments.length === 0) return result

  const inputs = payments
    .map((p, idx) => {
      const total = (Number(p.amount_cents) / 100).toFixed(2)
      return `${idx + 1}. id="${p.id}" total=$${total} memo: "${p.memo.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    })
    .join('\n')

  const prompt = `Extract service dates and per-person payment amounts from these check memos. Respond with ONLY a JSON array — no explanation, no markdown fences.

Memos:
${inputs}

Return this exact shape (one item per input, same order):
[{"id":"<payment id>","serviceDate":"YYYY-MM-DD or null","lines":[{"name":"Person Full Name","amountCents":4800}]}]

Rules for each memo:
- id: copy the id from the input exactly
- serviceDate: date in the memo as YYYY-MM-DD, or null
- lines: one entry per named person; skip facility names and generic words
- amountCents: integer cents (e.g. $48 → 4800); null only when a person has no explicit dollar amount
- If exactly one person has null amountCents, compute the remainder (total minus sum of explicit amounts) and use that as their amountCents when positive
- Names must be 2–4 words, actual human names only`

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    })
    if (!res.ok) return result
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim()
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    const parsed = JSON.parse(clean) as GeminiLineResult[]
    if (!Array.isArray(parsed)) return result
    for (const item of parsed) {
      if (!item?.id || !Array.isArray(item.lines)) continue
      result.set(item.id, {
        serviceDate:
          typeof item.serviceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.serviceDate)
            ? item.serviceDate
            : null,
        lines: item.lines
          .filter((l) => typeof l.name === 'string' && l.name.trim().length >= 2)
          .map((l) => ({
            rawName: l.name.trim(),
            amountCents:
              typeof l.amountCents === 'number' && Number.isFinite(l.amountCents) && l.amountCents >= 0
                ? Math.round(l.amountCents)
                : null,
          })),
      })
    }
  } catch {
    // Fall through — callers will use heuristic for any IDs missing from the map
  }
  return result
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    const body = bodySchema.safeParse(await req.json())
    if (!body.success) return Response.json({ error: 'Invalid body' }, { status: 400 })
    const { facilityId } = body.data

    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu || !canAccessBilling(fu.role)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      // Bookkeepers are cross-facility; admins must match
      if (fu.role !== 'bookkeeper' && fu.facilityId !== facilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const rl = await checkRateLimit('memoMatchBatch', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    // Fetch all unmatched memo payments (those with $ amounts, no breakdown yet)
    const rawRows = await db.execute(sql`
      SELECT id, facility_id, memo, amount_cents, check_num,
             to_char(payment_date, 'YYYY-MM-DD') AS payment_date
      FROM qb_payments
      WHERE facility_id = ${facilityId}
        AND is_demo = false
        AND memo IS NOT NULL
        AND memo ~ '\\$\\s?[0-9]'
        AND (resident_breakdown IS NULL OR resident_breakdown = '[]'::jsonb)
      ORDER BY payment_date DESC
      LIMIT 50
    `)
    const payments = rawRows as unknown as RawPayment[]

    if (payments.length === 0) {
      return Response.json({ data: { payments: [] } })
    }

    // Parse all memos — Gemini single call, heuristic fallback per payment
    const geminiResults = await geminiParseMemosBatch(payments)

    // Load residents + facility timezone once
    const [facility, residentList] = await Promise.all([
      db.query.facilities.findFirst({
        where: eq(facilities.id, facilityId),
        columns: { id: true, timezone: true },
      }),
      db.query.residents.findMany({
        where: and(
          eq(residents.facilityId, facilityId),
          eq(residents.active, true),
          eq(residents.isDemo, false) // is_demo filter — Phase 13
        ),
        columns: { id: true, name: true, roomNumber: true },
      }),
    ])
    const tz = facility?.timezone ?? 'America/New_York'

    // Build per-payment parsed results
    const paymentParsed: Array<{ payment: RawPayment; parsed: ParsedMemo }> = payments.map((p) => ({
      payment: p,
      parsed: geminiResults.get(p.id) ?? parseMemo(p.memo, Number(p.amount_cents)),
    }))

    // Collect ALL matched resident IDs across all payments for a single booking query
    interface MatchedLine {
      paymentId: string
      rawName: string
      amountCents: number | null
      resident: { id: string; name: string; roomNumber: string | null } | null
      confidence: 'high' | 'medium' | 'low' | null
      serviceDate: string | null
      paymentDate: string
    }
    const allMatchedLines: MatchedLine[] = []

    for (const { payment, parsed } of paymentParsed) {
      for (const line of parsed.lines) {
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
        allMatchedLines.push({
          paymentId: payment.id,
          rawName: line.rawName,
          amountCents: line.amountCents,
          resident: best,
          confidence: best ? confidence : null,
          serviceDate: parsed.serviceDate,
          paymentDate: payment.payment_date,
        })
      }
    }

    const allResidentIds = [
      ...new Set(allMatchedLines.filter((l) => l.resident).map((l) => l.resident!.id)),
    ]

    // Find date window: min payment date − 60 days to max payment date + 61 days
    const dates = payments.map((p) => p.payment_date).sort()
    const minDate = dates[0]
    const maxDate = dates[dates.length - 1]

    interface CandidateRow {
      id: string
      resident_id: string
      d: string
      service_label: string | null
      total: unknown
    }
    let allCandidates: CandidateRow[] = []
    if (allResidentIds.length > 0) {
      // price_cents only — never add tip_cents
      const rows = await db.execute(sql`
        SELECT b.id, b.resident_id,
               to_char(b.start_time AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d,
               COALESCE(NULLIF(array_to_string(b.service_names, ' + '), ''), s.name, b.raw_service_name) AS service_label,
               (b.price_cents + COALESCE(b.addon_total_cents, 0)) AS total
        FROM bookings b
        LEFT JOIN services s ON s.id = b.service_id
        WHERE b.facility_id = ${facilityId}
          AND b.resident_id IN (${sql.join(allResidentIds.map((id) => sql`${id}`), sql`, `)})
          AND b.status = 'completed' AND b.active = true AND b.is_demo = false
          AND b.payment_status = 'unpaid'
          AND b.start_time >= (${minDate}::date - INTERVAL '60 days')
          AND b.start_time < (${maxDate}::date + INTERVAL '61 days')
        ORDER BY b.start_time ASC
        LIMIT 1000
      `)
      allCandidates = rows as unknown as CandidateRow[]
    }

    // Claim bookings per payment (not globally) to avoid cross-payment conflicts
    const resultPayments = paymentParsed.map(({ payment, parsed }) => {
      const paymentLines = allMatchedLines.filter((l) => l.paymentId === payment.id)
      const claimed = new Set<string>()
      const targetDate = parsed.serviceDate ?? payment.payment_date
      const targetMs = new Date(targetDate + 'T00:00:00Z').getTime()

      const lines = paymentLines.map((ml) => {
        let booking: CandidateRow | null = null
        if (ml.resident) {
          const pool = allCandidates.filter(
            (c) => c.resident_id === ml.resident!.id && !claimed.has(c.id)
          )
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
          rawName: ml.rawName,
          amountCents: ml.amountCents,
          residentId: ml.resident?.id ?? null,
          residentName: ml.resident?.name ?? null,
          roomNumber: ml.resident?.roomNumber ?? null,
          confidence: ml.confidence,
          bookingId: booking?.id ?? null,
          bookingDate: booking?.d ?? null,
          serviceLabel: booking?.service_label ?? null,
          bookingTotalCents: booking ? Number(booking.total ?? 0) || 0 : null,
        }
      })

      const matchedCount = lines.filter((l) => l.residentId && l.amountCents != null).length

      return {
        paymentId: payment.id,
        checkNum: payment.check_num,
        paymentDate: payment.payment_date,
        amountCents: Number(payment.amount_cents),
        memo: payment.memo,
        serviceDate: parsed.serviceDate,
        lines,
        matchedCount,
        totalLines: lines.length,
      }
    })

    // Only return payments where at least one line matched a resident
    const matchable = resultPayments.filter((p) => p.matchedCount > 0)

    return Response.json({ data: { payments: matchable } })
  } catch (err) {
    console.error('[billing/memo-match-batch] POST error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
