// Auto-collect triggers for COF residents. Two entry points:
//   - autoCollectOnCompletion(bookingId): fired (fire-and-forget) by the booking
//     PUT route when a booking flips to 'completed' and the facility is in
//     'on_completion' mode.
//   - collectResidentBalance(residentId): used by the nightly autopay sweep cron.
// Both attempt the charge engine and fall back to the failover pay-link.

import { db } from '@/db'
import { bookings, facilities, residents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { ensurePaymentsSchema } from '@/lib/payments-ddl'
import { collectForResident, type CollectResult } from './charge'
import { sendPaymentRequest } from './pay-link'

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

async function handleFailover(
  result: CollectResult,
  residentId: string,
  amount: number,
  bookingId: string | null,
  facilityId: string | null = null,
): Promise<void> {
  if (result.ok) return
  if (result.code === 'invalid') return
  if (bookingId) {
    await db
      .update(bookings)
      .set({ autopayAttemptedAt: new Date(), autopayLastError: result.reason })
      .where(eq(bookings.id, bookingId))
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
