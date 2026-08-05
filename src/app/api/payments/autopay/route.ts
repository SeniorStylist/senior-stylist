// Set a resident's auto-collect (COF) configuration: enabled, method preference,
// and which saved card is the default.
//
// P50 — dual auth via authorizeResidentPayment: billing staff OR the family
// portal account linked to the resident. Portal actors get a RESTRICTED write:
// only autopayEnabled + defaultPaymentMethodId — autopayMethod (billing
// semantics: salon-account draw order) stays staff-owned and is stripped from
// portal requests. Enabling requires an active saved card.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { residents, paymentMethods, facilities } from '@/db/schema'
import { and, desc, eq, sql } from 'drizzle-orm'
import { authorizeResidentPayment } from '@/lib/payments/authorize'
import { ensurePaymentsSchema } from '@/lib/payments-ddl'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const residentId = request.nextUrl.searchParams.get('residentId')
    if (!residentId) return Response.json({ error: 'residentId required' }, { status: 422 })

    const auth = await authorizeResidentPayment(residentId)
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
    // P50 — stylists vault cards at the chair; autopay/billing stays off-limits.
    if (auth.actor.via === 'stylist') return Response.json({ error: 'Forbidden' }, { status: 403 })

    await ensurePaymentsSchema()
    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, residentId),
      columns: { autopayEnabled: true, autopayMethod: true, qbOutstandingBalanceCents: true },
    })
    const cards = await db
      .select({ id: paymentMethods.id, brand: paymentMethods.brand, last4: paymentMethods.last4, isDefault: paymentMethods.isDefault })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.residentId, residentId), eq(paymentMethods.active, true)))

    let availableCreditCents = 0
    try {
      const rows = (await db.execute(sql`
        SELECT COALESCE(SUM(open_balance_cents - applied_cents), 0) AS c
        FROM qb_unapplied_credits
        WHERE resident_id = ${residentId} AND (open_balance_cents - applied_cents) > 0
      `)) as unknown as Array<{ c: number | string }>
      availableCreditCents = Number(rows[0]?.c ?? 0) || 0
    } catch { availableCreditCents = 0 }

    return Response.json({
      data: {
        autopayEnabled: resident?.autopayEnabled ?? false,
        autopayMethod: resident?.autopayMethod ?? null,
        outstandingCents: resident?.qbOutstandingBalanceCents ?? 0,
        availableCreditCents,
        cards,
      },
    })
  } catch (err) {
    console.error('GET /api/payments/autopay error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const schema = z.object({
  residentId: z.string().uuid(),
  autopayEnabled: z.boolean().optional(),
  autopayMethod: z.enum(['salon_then_card', 'card', 'salon_account']).nullable().optional(),
  defaultPaymentMethodId: z.string().uuid().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })
    const body = parsed.data

    const auth = await authorizeResidentPayment(body.residentId)
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })
    // P50 — stylists vault cards at the chair; autopay/billing stays off-limits.
    if (auth.actor.via === 'stylist') return Response.json({ error: 'Forbidden' }, { status: 403 })

    await ensurePaymentsSchema()

    // P50 — portal actors can flip the switch and pick the main card, nothing else.
    if (auth.actor.via === 'portal') body.autopayMethod = undefined

    // Safeguard (2026-07-07): flipping autopay ON must never be silent — the payor
    // gets an email so a card is never auto-charged "without knowing".
    const before = await db.query.residents.findFirst({
      where: eq(residents.id, body.residentId),
      columns: { autopayEnabled: true, autopayMethod: true, name: true, poaEmail: true, facilityId: true },
    })

    // Promote the chosen card to default FIRST (scoped to this resident's active
    // cards) so an enable-with-card-pick in one request passes the card check.
    if (body.defaultPaymentMethodId) {
      const card = await db.query.paymentMethods.findFirst({
        where: and(
          eq(paymentMethods.id, body.defaultPaymentMethodId),
          eq(paymentMethods.residentId, body.residentId),
          eq(paymentMethods.active, true),
        ),
        columns: { id: true },
      })
      if (card) {
        await db
          .update(paymentMethods)
          .set({ isDefault: false })
          .where(eq(paymentMethods.residentId, body.residentId))
        await db.update(paymentMethods).set({ isDefault: true }).where(eq(paymentMethods.id, card.id))
      }
    }

    // PORTAL enable requires a saved card — family autopay always charges a
    // card, and enabling with nothing to charge is a trap that silently fails
    // on every visit. Staff keep the old semantics (salon_account needs no
    // card; the collect engine has structured no_card failover).
    if (auth.actor.via === 'portal' && body.autopayEnabled === true) {
      const anyCard = await db.query.paymentMethods.findFirst({
        where: and(eq(paymentMethods.residentId, body.residentId), eq(paymentMethods.active, true)),
        orderBy: [desc(paymentMethods.isDefault), desc(paymentMethods.createdAt)],
        columns: { id: true },
      })
      if (!anyCard) {
        return Response.json({ error: 'Add a card first — automatic payment needs a saved card.' }, { status: 400 })
      }
    }

    const set: Partial<typeof residents.$inferInsert> = { updatedAt: new Date() }
    if (body.autopayEnabled !== undefined) set.autopayEnabled = body.autopayEnabled
    if (body.autopayMethod !== undefined) set.autopayMethod = body.autopayMethod
    // Portal enable with no method configured → plain card charging (the family
    // never chooses salon-account semantics; staff can refine later).
    if (auth.actor.via === 'portal' && body.autopayEnabled === true && !before?.autopayMethod) {
      set.autopayMethod = 'card'
    }
    if (Object.keys(set).length > 1) {
      await db.update(residents).set(set).where(eq(residents.id, body.residentId))
    }

    const flipped =
      body.autopayEnabled !== undefined && before && body.autopayEnabled !== (before.autopayEnabled ?? false)
    if (flipped) {
      void (async () => {
        const [{ sendEmail, buildAutopayEnabledEmailHtml }, { getFamilyRecipients }, facility, card] = await Promise.all([
          import('@/lib/email'),
          import('@/lib/portal-recipients'),
          db.query.facilities.findFirst({
            where: eq(facilities.id, before.facilityId),
            columns: { name: true },
          }),
          db.query.paymentMethods.findFirst({
            where: and(eq(paymentMethods.residentId, body.residentId), eq(paymentMethods.active, true), eq(paymentMethods.isDefault, true)),
            columns: { brand: true, last4: true },
          }),
        ])
        // P50 — consent notice goes to the poaEmail AND every linked portal
        // account (the acting family member is often a different address).
        // Security notice — NOT gated on the email-reminders preference.
        const recipients = await getFamilyRecipients(body.residentId)
        const emails = recipients?.emails?.length ? recipients.emails : before.poaEmail ? [before.poaEmail] : []
        if (emails.length === 0) return
        const html = buildAutopayEnabledEmailHtml({
          residentName: before.name,
          facilityName: facility?.name ?? 'Senior Stylist',
          cardLabel: card?.brand ? `${card.brand.toUpperCase()} ••${card.last4 ?? ''}` : null,
          enabled: body.autopayEnabled === true,
        })
        await Promise.all(
          emails.map((to) =>
            sendEmail({
              to,
              subject: `Automatic payment turned ${body.autopayEnabled ? 'on' : 'off'} — ${facility?.name ?? 'Senior Stylist'}`,
              html,
            }).catch(() => false),
          ),
        )
      })().catch((err) => console.error('[autopay POST] consent email failed:', err))
    }

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/payments/autopay error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
