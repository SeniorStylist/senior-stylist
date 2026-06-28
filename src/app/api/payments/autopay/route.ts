// Set a resident's auto-collect (COF) configuration: enabled, method preference,
// and which saved card is the default. Billing staff only.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { residents, paymentMethods } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { ensurePaymentsSchema } from '@/lib/payments-ddl'

export const dynamic = 'force-dynamic'

// Shared billing-staff + facility-scope guard for both verbs.
async function authorize(residentId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: 'Unauthorized' }

  const resident = await db.query.residents.findFirst({
    where: eq(residents.id, residentId),
    columns: { id: true, facilityId: true },
  })
  if (!resident) return { ok: false as const, status: 404, error: 'Not found' }

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!isMaster) {
    const fu = await getUserFacility(user.id)
    if (!fu || !canAccessBilling(fu.role)) return { ok: false as const, status: 403, error: 'Forbidden' }
    if (fu.role !== 'bookkeeper' && fu.facilityId !== resident.facilityId) {
      return { ok: false as const, status: 403, error: 'Forbidden' }
    }
  }
  return { ok: true as const, facilityId: resident.facilityId }
}

export async function GET(request: NextRequest) {
  try {
    const residentId = request.nextUrl.searchParams.get('residentId')
    if (!residentId) return Response.json({ error: 'residentId required' }, { status: 422 })

    const auth = await authorize(residentId)
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

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

    const auth = await authorize(body.residentId)
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status })

    await ensurePaymentsSchema()

    const set: Partial<typeof residents.$inferInsert> = { updatedAt: new Date() }
    if (body.autopayEnabled !== undefined) set.autopayEnabled = body.autopayEnabled
    if (body.autopayMethod !== undefined) set.autopayMethod = body.autopayMethod
    if (Object.keys(set).length > 1) {
      await db.update(residents).set(set).where(eq(residents.id, body.residentId))
    }

    // Promote the chosen card to default (scoped to this resident's active cards).
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

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/payments/autopay error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
