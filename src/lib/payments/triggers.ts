// Auto-collect triggers for COF residents. Three entry points:
//   - autoCollectOnCompletion(bookingId): fired (fire-and-forget) by the booking
//     PUT route when a booking flips to 'completed' and the facility is in
//     'on_completion' mode.
//   - autoCollectOnFinalize(facilityId, stylistId, dateStr): P55 — fired
//     (fire-and-forget) when a stylist finalizes the day log. Sweeps that
//     stylist-day's completed unpaid bookings for autopay residents — the
//     owners' "charges run when the log sheet is validated" decision, and the
//     catch-all for rows the per-booking trigger never saw (OCR imports,
//     bulk edits, walk-ins flipped completed by any path).
//   - collectResidentBalance(residentId): used by the nightly autopay sweep cron.
// All attempt the charge engine and fall back to the failover pay-link.

import { createHash } from 'node:crypto'
import { db } from '@/db'
import { bookings, facilities, residents } from '@/db/schema'
import { and, eq, gte, inArray, lt } from 'drizzle-orm'
import { ensurePaymentsSchema } from '@/lib/payments-ddl'
import { dayRangeInTimezone } from '@/lib/time'
import { collectForResident, type CollectResult } from './charge'
import { sendPaymentRequest } from './pay-link'

/**
 * P55 — stable fingerprint of a booking-id set for Stripe idempotency keys.
 * Same set → same key (a retry dedupes at Stripe); a re-finalize that includes
 * NEW bookings produces a different key, avoiding Stripe's same-key-with-
 * different-params 400. Shared by the finalize sweep and the OCR charge route.
 */
export function bookingSetHash(bookingIds: string[]): string {
  return createHash('sha256').update([...bookingIds].sort().join(',')).digest('hex').slice(0, 16)
}

export async function autoCollectOnCompletion(bookingId: string): Promise<void> {
  try {
    await ensurePaymentsSchema()
    const b = await db.query.bookings.findFirst({
      where: eq(bookings.id, bookingId),
      columns: {
        id: true,
        residentId: true,
        facilityId: true,
        priceCents: true,
        addonTotalCents: true,
        paymentStatus: true,
        isDemo: true,
        active: true,
        autopayAttemptedAt: true,
      },
    })
    if (!b || !b.active || b.isDemo || b.paymentStatus === 'paid') return

    // Safeguard (2026-07-07): a completion re-fire must not re-charge a booking
    // whose charge was just attempted (e.g. captured at Stripe but the DB write
    // raced). 10-minute cool-down per booking.
    if (b.autopayAttemptedAt && Date.now() - new Date(b.autopayAttemptedAt).getTime() < 10 * 60 * 1000) {
      return
    }

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, b.facilityId),
      columns: { autopayMode: true },
    })
    if (facility?.autopayMode !== 'on_completion') return

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, b.residentId),
      columns: { autopayEnabled: true },
    })
    if (!resident?.autopayEnabled) return

    // Service revenue only (price + addons). Tips are excluded from auto-charge so
    // the rev-share split stays correct — staff can collect tips via "Collect now".
    const amount = (b.priceCents ?? 0) + (b.addonTotalCents ?? 0)
    if (amount <= 0) return

    // Stamp the attempt BEFORE charging so the cool-down above protects against
    // a charge that captures at Stripe but fails to record.
    await db.update(bookings).set({ autopayAttemptedAt: new Date() }).where(eq(bookings.id, b.id))

    const result = await collectForResident({
      residentId: b.residentId,
      amountCents: amount,
      bookingIds: [b.id],
      recordedVia: 'auto_charge',
      idempotencyKey: `oncomplete:${b.id}`,
    })
    await handleFailover(result, b.residentId, amount, b.id, b.facilityId)
  } catch (err) {
    console.error('[payments.autoCollectOnCompletion] failed:', err)
  }
}

/**
 * P55 — charge-on-finalize sweep. Called fire-and-forget when a day log is
 * finalized: charges each autopay resident's completed UNPAID bookings for
 * that stylist-day in one PaymentIntent per resident. Idempotent by design —
 * the "paid stamp" (bookings.payment_status='paid', written in the same tx as
 * the payment) plus the unpaid re-check in collectForResident mean an edited /
 * unfinalized / re-finalized log can never double-charge; bookings inside the
 * 10-minute autopay_attempted_at cooldown (e.g. just charged by the
 * on-completion trigger, or declined moments ago) are skipped and picked up
 * by a later re-finalize. Never throws.
 */
export async function autoCollectOnFinalize(facilityId: string, stylistId: string, dateStr: string): Promise<void> {
  try {
    await ensurePaymentsSchema()

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { autopayMode: true, timezone: true, isDemo: true },
    })
    if (!facility || facility.isDemo || facility.autopayMode !== 'on_completion') return

    const range = dayRangeInTimezone(dateStr, facility.timezone ?? 'America/New_York')
    if (!range) return

    const rows = await db
      .select({
        id: bookings.id,
        residentId: bookings.residentId,
        priceCents: bookings.priceCents,
        addonTotalCents: bookings.addonTotalCents,
        autopayAttemptedAt: bookings.autopayAttemptedAt,
      })
      .from(bookings)
      .where(and(
        eq(bookings.facilityId, facilityId),
        eq(bookings.stylistId, stylistId),
        eq(bookings.active, true),
        eq(bookings.isDemo, false),
        eq(bookings.status, 'completed'),
        eq(bookings.paymentStatus, 'unpaid'),
        gte(bookings.startTime, range.start),
        lt(bookings.startTime, range.end),
      ))
    if (rows.length === 0) return

    // Skip bookings inside the 10-min attempt cooldown (mirrors on-completion).
    const cutoff = Date.now() - 10 * 60 * 1000
    const eligible = rows.filter(
      (b) => !b.autopayAttemptedAt || new Date(b.autopayAttemptedAt).getTime() < cutoff,
    )
    if (eligible.length === 0) return

    // Group by resident; ONE batched residents load (max:1 pool — no per-row queries).
    const byResident = new Map<string, typeof eligible>()
    for (const b of eligible) {
      const arr = byResident.get(b.residentId) ?? []
      arr.push(b)
      byResident.set(b.residentId, arr)
    }
    const residentRows = await db.query.residents.findMany({
      where: and(
        inArray(residents.id, Array.from(byResident.keys())),
        eq(residents.active, true),
        eq(residents.isDemo, false),
        eq(residents.autopayEnabled, true), // owner decision: autopay opt-in only
      ),
      columns: { id: true },
    })

    // Sequential per resident (max:1 pool + sequential Stripe, like the sweep cron).
    for (const r of residentRows) {
      try {
        const set = byResident.get(r.id) ?? []
        const bookingIds = set.map((b) => b.id)
        // price_cents only — never add tip_cents (revenue guard); tips stay
        // manual via "Collect now" so rev-share math holds.
        const amount = set.reduce((s, b) => s + (b.priceCents ?? 0) + (b.addonTotalCents ?? 0), 0)
        if (amount <= 0 || bookingIds.length === 0) continue

        // Stamp attempts BEFORE charging (the cooldown protection).
        await db.update(bookings).set({ autopayAttemptedAt: new Date() }).where(inArray(bookings.id, bookingIds))

        const result = await collectForResident({
          residentId: r.id,
          amountCents: amount,
          bookingIds,
          recordedVia: 'auto_charge',
          idempotencyKey: `finalize:${r.id}:${dateStr}:${bookingSetHash(bookingIds)}`,
        })
        await handleFailover(result, r.id, amount, bookingIds, facilityId)
      } catch (err) {
        // One declined/broken resident must not stop the rest of the day.
        console.error('[payments.autoCollectOnFinalize] resident charge failed:', err)
      }
    }
  } catch (err) {
    console.error('[payments.autoCollectOnFinalize] failed:', err)
  }
}

/** Sweep helper: collect a resident's full outstanding balance (autopay-enabled only). */
export async function collectResidentBalance(
  residentId: string,
  dateKey: string,
): Promise<{ attempted: boolean; result?: CollectResult }> {
  const resident = await db.query.residents.findFirst({
    where: eq(residents.id, residentId),
    columns: { id: true, facilityId: true, autopayEnabled: true, qbOutstandingBalanceCents: true, isDemo: true },
  })
  if (!resident || resident.isDemo || !resident.autopayEnabled) return { attempted: false }
  const balance = resident.qbOutstandingBalanceCents ?? 0
  if (balance <= 0) return { attempted: false }

  const result = await collectForResident({
    residentId,
    amountCents: balance,
    recordedVia: 'auto_charge',
    idempotencyKey: `sweep:${residentId}:${dateKey}`,
  })
  await handleFailover(result, residentId, balance, null, resident.facilityId)
  return { attempted: true, result }
}

export async function handleFailover(
  result: CollectResult,
  residentId: string,
  amount: number,
  bookingId: string | string[] | null,
  facilityId: string | null = null,
): Promise<void> {
  if (result.ok) return
  if (result.code === 'invalid') return
  // P55 — accepts a set too (finalize/OCR sweeps stamp the whole group).
  const ids = bookingId == null ? [] : Array.isArray(bookingId) ? bookingId : [bookingId]
  if (ids.length > 0) {
    await db
      .update(bookings)
      .set({ autopayAttemptedAt: new Date(), autopayLastError: result.reason })
      .where(inArray(bookings.id, ids))
  }
  const uncollected = amount - result.salonCents
  await sendPaymentRequest({
    residentId,
    amountCents: uncollected > 0 ? uncollected : undefined,
    reason: result.reason,
  })

  // Safeguard (2026-07-07): staff must SEE failed auto-charges, not just the payor.
  // Bell + push to facility admins (fire-and-forget; notifyFacilityAdmins never throws).
  if (facilityId) {
    void (async () => {
      const [{ notifyFacilityAdmins }, resident] = await Promise.all([
        import('@/lib/notify'),
        db.query.residents.findFirst({ where: eq(residents.id, residentId), columns: { name: true } }),
      ])
      await notifyFacilityAdmins(facilityId, {
        type: 'payment_failed',
        title: 'Auto-charge failed',
        body: `${resident?.name ?? 'A resident'} — ${result.reason}. A payment link was sent to the family.`,
        url: '/billing',
      })
    })().catch((err) => console.error('[payments.failover] admin notify failed:', err))
  }
}
