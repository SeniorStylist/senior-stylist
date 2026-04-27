import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { payPeriods, stylistPayItems, stylists, facilities, payDeductions } from '@/db/schema'
import { getUserFacility, canAccessPayroll } from '@/lib/get-facility-id'
import { sanitizeStylist } from '@/lib/sanitize'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'
import { sendEmail, buildPayrollNotificationHtml } from '@/lib/email'

const updateSchema = z
  .object({
    status: z.enum(['open', 'processing', 'paid']).optional(),
    periodType: z.enum(['weekly', 'biweekly', 'monthly']).optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' })

const STATUS_ORDER: Record<string, number> = { open: 0, processing: 1, paid: 2 }

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!canAccessPayroll(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const row = await db.query.payPeriods.findFirst({
      where: and(eq(payPeriods.id, id), eq(payPeriods.facilityId, facilityUser.facilityId)),
      with: {
        items: {
          with: {
            stylist: true,
            deductions: true,
          },
        },
      },
    })

    if (!row) return Response.json({ error: 'Not found' }, { status: 404 })

    const items = row.items
      .map((it) => ({
        ...it,
        stylist: sanitizeStylist(it.stylist),
      }))
      .sort((a, b) => a.stylist.name.localeCompare(b.stylist.name))

    const { items: _drop, ...periodFields } = row
    void _drop

    return Response.json({
      data: {
        period: periodFields,
        items,
      },
    })
  } catch (err) {
    console.error('GET /api/pay-periods/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!canAccessPayroll(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const existing = await db.query.payPeriods.findFirst({
      where: and(eq(payPeriods.id, id), eq(payPeriods.facilityId, facilityUser.facilityId)),
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    if (existing.status === 'paid') {
      return Response.json({ error: 'Period is paid and locked' }, { status: 403 })
    }

    if (parsed.data.status) {
      const from = STATUS_ORDER[existing.status]
      const to = STATUS_ORDER[parsed.data.status]
      if (to < from) {
        return Response.json({ error: 'Cannot move status backwards' }, { status: 400 })
      }
    }

    const [updated] = await db
      .update(payPeriods)
      .set({
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        ...(parsed.data.periodType !== undefined ? { periodType: parsed.data.periodType } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(payPeriods.id, id))
      .returning()

    revalidateTag('pay-periods', {})

    if (parsed.data.status === 'paid' && existing.status !== 'paid') {
      void (async () => {
        try {
          const facilityRow = await db.query.facilities.findFirst({
            where: eq(facilities.id, facilityUser.facilityId),
            columns: { name: true },
          })
          const items = await db
            .select({
              stylistId: stylistPayItems.stylistId,
              stylistName: stylists.name,
              email: stylists.email,
              grossRevenueCents: stylistPayItems.grossRevenueCents,
              commissionRate: stylistPayItems.commissionRate,
              commissionAmountCents: stylistPayItems.commissionAmountCents,
              netPayCents: stylistPayItems.netPayCents,
              payItemId: stylistPayItems.id,
            })
            .from(stylistPayItems)
            .innerJoin(stylists, eq(stylistPayItems.stylistId, stylists.id))
            .where(eq(stylistPayItems.payPeriodId, id))

          const deductionRows = await db.query.payDeductions.findMany({
            where: eq(payDeductions.payPeriodId, id),
            columns: { stylistId: true, deductionType: true, amountCents: true },
          })

          const fmtLong = (iso: string) =>
            new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
          const fmtShort = (iso: string) =>
            new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

          const subject = existing.periodType === 'monthly'
            ? `Your pay is ready — ${new Date(`${existing.startDate.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
            : `Your pay is ready — ${fmtShort(existing.startDate)} – ${fmtShort(existing.endDate)}`

          for (const item of items) {
            if (!item.email) continue
            const deductions = deductionRows
              .filter((d) => d.stylistId === item.stylistId)
              .map((d) => ({ name: d.deductionType, amountCents: d.amountCents }))
            void sendEmail({
              to: item.email,
              subject,
              html: buildPayrollNotificationHtml({
                stylistName: item.stylistName,
                facilityName: facilityRow?.name ?? 'your facility',
                periodStart: fmtLong(existing.startDate),
                periodEnd: fmtLong(existing.endDate),
                grossRevenueCents: item.grossRevenueCents ?? 0,
                commissionRate: item.commissionRate ?? 0,
                commissionAmountCents: item.commissionAmountCents ?? 0,
                deductions,
                netPayCents: item.netPayCents ?? 0,
              }),
            })
          }
        } catch (e) {
          console.error('[payroll-email]', e)
        }
      })()
    }

    return Response.json({ data: { period: updated } })
  } catch (err) {
    console.error('PUT /api/pay-periods/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
