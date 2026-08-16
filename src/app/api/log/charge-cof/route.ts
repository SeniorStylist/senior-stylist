// P55 — human-confirmed card-on-file charges after an OCR log-sheet import.
// The owners' rule: scanned paper sheets DO charge saved cards, but only
// behind an explicit confirmation (fuzzy name matching must never charge the
// wrong Smith). The client sends only the batch id + the resident ids the
// human checked — the booking set and amounts are RE-DERIVED server-side from
// the batch, so nothing forgeable rides the request.

import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canScanLogs } from '@/lib/get-facility-id'
import { getEffectiveStylistId } from '@/lib/effective-stylist'
import { db } from '@/db'
import { bookings, importBatches, residents } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { collectForResident } from '@/lib/payments/charge'
import { bookingSetHash, handleFailover } from '@/lib/payments/triggers'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const schema = z.object({
  importBatchId: z.string().uuid(),
  residentIds: z.array(z.string().uuid()).min(1).max(100),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isMasterAdmin = !!superAdminEmail && user.email === superAdminEmail

    // Mirrors the import route: master OR canScanLogs OR a stylist charging
    // their OWN just-imported sheet (ownership enforced per derived booking).
    let selfStylistId: string | null = null
    if (!isMasterAdmin && !canScanLogs(facilityUser.role)) {
      if (facilityUser.role !== 'stylist') {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      selfStylistId = await getEffectiveStylistId(user.id)
      if (!selfStylistId) {
        return Response.json(
          { error: "Your account isn't linked to a stylist profile yet — ask your admin to link you in Settings → Team." },
          { status: 403 },
        )
      }
    }

    const rl = await checkRateLimit('paymentCollect', `u:${user.id}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const body = await request.json().catch(() => null)
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })
    const parsed = schema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })
    const { importBatchId, residentIds } = parsed.data

    const batch = await db.query.importBatches.findFirst({
      where: eq(importBatches.id, importBatchId),
      columns: { id: true, facilityId: true, deletedAt: true },
    })
    if (!batch || batch.deletedAt) return Response.json({ error: 'Import batch not found' }, { status: 404 })

    // Facility scope: bookkeeper (cross-facility by role) + master may charge
    // any facility's batch; everyone else is pinned to their own.
    if (!isMasterAdmin && facilityUser.role !== 'bookkeeper' && batch.facilityId !== facilityUser.facilityId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Re-derive the chargeable set: this batch's still-unpaid completed
    // bookings for the checked residents (amounts come from the rows, never
    // the client). paymentStatus 'unpaid' excludes waived + already-charged.
    const rows = await db
      .select({
        id: bookings.id,
        residentId: bookings.residentId,
        stylistId: bookings.stylistId,
        priceCents: bookings.priceCents,
      })
      .from(bookings)
      .where(and(
        eq(bookings.importBatchId, importBatchId),
        inArray(bookings.residentId, residentIds),
        eq(bookings.active, true),
        eq(bookings.isDemo, false),
        eq(bookings.status, 'completed'),
        eq(bookings.paymentStatus, 'unpaid'),
      ))
    if (selfStylistId && rows.some((r) => r.stylistId !== selfStylistId)) {
      return Response.json({ error: 'You can only charge your own imported bookings.' }, { status: 403 })
    }

    const byResident = new Map<string, typeof rows>()
    for (const r of rows) {
      const arr = byResident.get(r.residentId) ?? []
      arr.push(r)
      byResident.set(r.residentId, arr)
    }

    // Autopay opt-in gate re-checked server-side (owner decision) — the
    // candidate list the modal showed is advisory, never trusted.
    const eligibleResidents = await db.query.residents.findMany({
      where: and(
        inArray(residents.id, Array.from(byResident.keys())),
        eq(residents.active, true),
        eq(residents.isDemo, false),
        eq(residents.autopayEnabled, true),
      ),
      columns: { id: true },
    })

    const results: Array<{ residentId: string; ok: boolean; collectedCents?: number; code?: string; reason?: string }> = []
    // Sequential per resident (max:1 pool + sequential Stripe, like the sweep).
    for (const r of eligibleResidents) {
      const set = byResident.get(r.id) ?? []
      const bookingIds = set.map((b) => b.id)
      // price_cents only — never add tip_cents (revenue guard)
      const amount = set.reduce((s, b) => s + (b.priceCents ?? 0), 0)
      if (amount <= 0 || bookingIds.length === 0) {
        results.push({ residentId: r.id, ok: false, code: 'invalid', reason: 'Nothing to collect' })
        continue
      }
      try {
        // Stamp attempts BEFORE charging (cooldown protection, mirrors triggers).
        await db.update(bookings).set({ autopayAttemptedAt: new Date() }).where(inArray(bookings.id, bookingIds))
        const result = await collectForResident({
          residentId: r.id,
          amountCents: amount,
          bookingIds,
          collectedBy: user.id,
          recordedVia: 'auto_charge',
          idempotencyKey: `ocr:${importBatchId}:${r.id}:${bookingSetHash(bookingIds)}`,
        })
        await handleFailover(result, r.id, amount, bookingIds, batch.facilityId)
        results.push(
          result.ok
            ? { residentId: r.id, ok: true, collectedCents: result.collectedCents }
            : { residentId: r.id, ok: false, code: result.code, reason: result.reason },
        )
      } catch (err) {
        console.error('[charge-cof] resident charge failed:', err)
        results.push({ residentId: r.id, ok: false, code: 'error', reason: 'Charge failed' })
      }
    }
    // Residents the human checked but who are no longer eligible (autopay off,
    // already paid) come back as skipped so the UI can say so.
    const eligibleIds = new Set(eligibleResidents.map((r) => r.id))
    for (const id of residentIds) {
      if (!eligibleIds.has(id) && !results.some((x) => x.residentId === id)) {
        results.push({ residentId: id, ok: false, code: 'invalid', reason: 'Nothing to charge (already paid or autopay off)' })
      }
    }

    return Response.json({ data: { results } })
  } catch (err) {
    console.error('POST /api/log/charge-cof error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
