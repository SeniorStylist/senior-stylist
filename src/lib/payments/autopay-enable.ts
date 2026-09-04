// P54 — family-style autopay enable, extracted from POST /api/payments/autopay
// so the signup wizard's card save (methods POST enableAutopay) and the portal
// autopay toggle share ONE guard + write + consent-email path that can never
// fork. "Family-style" = requires an active saved card and defaults the method
// to plain 'card' when unset (families never choose salon-account semantics).

import { db } from '@/db'
import { residents, paymentMethods, facilities } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { ensurePaymentsSchema } from '@/lib/payments-ddl'

/**
 * Consent email — the payor must never be auto-charged "without knowing".
 * Fire-and-forget by design (security notice, not gated on email-reminders
 * preference; goes to poaEmail ∪ every linked portal account). Shared verbatim
 * by the autopay route and enableFamilyAutopay below.
 */
export function notifyAutopayChanged(opts: {
  residentId: string
  residentName: string
  poaEmail: string | null
  facilityId: string
  enabled: boolean
}): void {
  const { residentId, residentName, poaEmail, facilityId, enabled } = opts
  void (async () => {
    const [{ sendEmail, buildAutopayEnabledEmailHtml }, { getFamilyRecipients }, facility, card] = await Promise.all([
      import('@/lib/email'),
      import('@/lib/portal-recipients'),
      db.query.facilities.findFirst({
        where: eq(facilities.id, facilityId),
        columns: { name: true },
      }),
      db.query.paymentMethods.findFirst({
        where: and(eq(paymentMethods.residentId, residentId), eq(paymentMethods.active, true), eq(paymentMethods.isDefault, true)),
        columns: { brand: true, last4: true },
      }),
    ])
    const recipients = await getFamilyRecipients(residentId)
    const emails = recipients?.emails?.length ? recipients.emails : poaEmail ? [poaEmail] : []
    const facilityName = facility?.name ?? 'Senior Stylist'
    const cardLabel = card?.brand ? `${card.brand.toUpperCase()} ••${card.last4 ?? ''}` : null
    // P60 — this notice is the "wasn't you?" safety net that makes a
    // staff-attested enable acceptable at all, so it must reach a phone-only
    // family too (P55 made phone a first-class portal identity). Email-only
    // meant those families were switched to automatic charging in silence.
    const phones = recipients?.phones ?? []
    if (emails.length === 0 && phones.length === 0) return
    if (emails.length > 0) {
      const html = buildAutopayEnabledEmailHtml({
        residentName,
        facilityName,
        cardLabel,
        enabled,
      })
      await Promise.all(
        emails.map((to) =>
          sendEmail({
            to,
            subject: `Automatic payment turned ${enabled ? 'on' : 'off'} — ${facilityName}`,
            html,
          }).catch(() => false),
        ),
      )
    }
    if (phones.length > 0) {
      const { sendSms, buildAutopayChangedSms } = await import('@/lib/sms')
      const body = buildAutopayChangedSms({ residentName, facilityName, cardLabel, enabled })
      for (const phone of phones) sendSms(phone, body).catch(() => {})
    }
  })().catch((err) => console.error('[autopay-enable] consent email failed:', err))
}

/**
 * Enable autopay for a resident the family way: requires an active saved card,
 * sets autopayMethod to 'card' when unset, and sends the consent email when
 * the switch actually flips. Never throws.
 */
export async function enableFamilyAutopay(
  residentId: string,
): Promise<{ ok: true; flipped: boolean } | { ok: false; error: string }> {
  try {
    await ensurePaymentsSchema()
    const before = await db.query.residents.findFirst({
      where: eq(residents.id, residentId),
      columns: { autopayEnabled: true, autopayMethod: true, name: true, poaEmail: true, facilityId: true },
    })
    if (!before) return { ok: false, error: 'Resident not found' }

    const anyCard = await db.query.paymentMethods.findFirst({
      where: and(eq(paymentMethods.residentId, residentId), eq(paymentMethods.active, true)),
      columns: { id: true },
    })
    if (!anyCard) {
      return { ok: false, error: 'Add a card first — automatic payment needs a saved card.' }
    }

    await db
      .update(residents)
      .set({
        autopayEnabled: true,
        ...(before.autopayMethod ? {} : { autopayMethod: 'card' }),
        updatedAt: new Date(),
      })
      .where(eq(residents.id, residentId))

    const flipped = !(before.autopayEnabled ?? false)
    if (flipped) {
      notifyAutopayChanged({
        residentId,
        residentName: before.name,
        poaEmail: before.poaEmail,
        facilityId: before.facilityId,
        enabled: true,
      })
    }
    return { ok: true, flipped }
  } catch (err) {
    console.error('[autopay-enable] enableFamilyAutopay failed:', err)
    return { ok: false, error: 'Could not turn on automatic payment' }
  }
}
