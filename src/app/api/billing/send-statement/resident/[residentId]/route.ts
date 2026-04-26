import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbInvoices } from '@/db/schema'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { sendEmail, buildResidentStatementHtml } from '@/lib/email'
import { z } from 'zod'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  to: z.string().email().max(320),
  force: z.boolean().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ residentId: string }> }
) {
  const { residentId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  const rawBody = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
  const { to, force } = parsed.data

  try {
    const resident = await db.query.residents.findFirst({
      where: and(eq(residents.id, residentId), eq(residents.active, true)),
      columns: { id: true, name: true, roomNumber: true, facilityId: true, qbOutstandingBalanceCents: true, poaName: true },
    })

    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu || !canAccessBilling(fu.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (fu.facilityId !== resident.facilityId) return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('billingSend', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    // Dedup check
    const recent = await db
      .select({ lastSentAt: qbInvoices.lastSentAt })
      .from(qbInvoices)
      .where(and(eq(qbInvoices.residentId, residentId), isNotNull(qbInvoices.lastSentAt)))
      .orderBy(desc(qbInvoices.lastSentAt))
      .limit(1)

    if (recent[0]?.lastSentAt && !force) {
      const lastSent = new Date(recent[0].lastSentAt as unknown as string | Date)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      if (lastSent > sevenDaysAgo) {
        return Response.json({ warning: true, lastSentAt: lastSent.toISOString() }, { status: 200 })
      }
    }

    const [facilityRow, invoiceList] = await Promise.all([
      db.query.facilities.findFirst({
        where: eq(facilities.id, resident.facilityId),
        columns: { name: true },
      }),
      db.query.qbInvoices.findMany({
        where: eq(qbInvoices.residentId, residentId),
        columns: {
          id: true,
          invoiceNum: true,
          invoiceDate: true,
          amountCents: true,
          openBalanceCents: true,
          status: true,
        },
        orderBy: [desc(qbInvoices.invoiceDate)],
      }),
    ])

    const html = buildResidentStatementHtml({
      residentName: resident.name,
      roomNumber: resident.roomNumber ?? null,
      facilityName: facilityRow?.name ?? '',
      outstandingCents: resident.qbOutstandingBalanceCents ?? 0,
      invoices: invoiceList,
      poaName: resident.poaName ?? null,
    })

    await sendEmail({
      to,
      subject: `Billing Reminder — ${resident.name}`,
      html,
    })

    if (invoiceList.length > 0) {
      await db
        .update(qbInvoices)
        .set({ lastSentAt: new Date(), sentVia: 'resend' })
        .where(eq(qbInvoices.residentId, residentId))
    }

    return Response.json({ data: { sent: true } })
  } catch (err) {
    console.error('[billing/send-statement/resident] error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
