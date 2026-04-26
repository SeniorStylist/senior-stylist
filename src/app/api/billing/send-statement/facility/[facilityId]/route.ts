import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbInvoices, qbPayments } from '@/db/schema'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { sendEmail, buildFacilityStatementHtml } from '@/lib/email'
import { z } from 'zod'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  to: z.string().email().max(320),
  force: z.boolean().optional(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ facilityId: string }> }
) {
  const { facilityId } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  if (!isMaster) {
    const fu = await getUserFacility(user.id)
    if (!fu || !canAccessBilling(fu.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (fu.facilityId !== facilityId) return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await checkRateLimit('billingSend', user.id)
  if (!rl.ok) return rateLimitResponse(rl.retryAfter)

  const rawBody = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
  const { to, force } = parsed.data

  try {
    // Dedup check: find most recent lastSentAt across all invoices for this facility
    const recent = await db
      .select({ lastSentAt: qbInvoices.lastSentAt })
      .from(qbInvoices)
      .where(and(eq(qbInvoices.facilityId, facilityId), isNotNull(qbInvoices.lastSentAt)))
      .orderBy(desc(qbInvoices.lastSentAt))
      .limit(1)

    if (recent[0]?.lastSentAt && !force) {
      const lastSent = new Date(recent[0].lastSentAt as unknown as string | Date)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      if (lastSent > sevenDaysAgo) {
        return Response.json({ warning: true, lastSentAt: lastSent.toISOString() }, { status: 200 })
      }
    }

    const [facility, residentList, invoiceList, paymentList] = await Promise.all([
      db.query.facilities.findFirst({
        where: eq(facilities.id, facilityId),
        columns: {
          id: true,
          name: true,
          facilityCode: true,
          address: true,
          paymentType: true,
          qbOutstandingBalanceCents: true,
          qbRevShareType: true,
        },
      }),
      db.query.residents.findMany({
        where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
        columns: { id: true, name: true, roomNumber: true, qbOutstandingBalanceCents: true },
        orderBy: (t, { asc }) => [asc(t.name)],
      }),
      db.query.qbInvoices.findMany({
        where: eq(qbInvoices.facilityId, facilityId),
        columns: {
          id: true,
          residentId: true,
          invoiceNum: true,
          invoiceDate: true,
          amountCents: true,
          openBalanceCents: true,
          status: true,
        },
        orderBy: [desc(qbInvoices.invoiceDate)],
      }),
      db.query.qbPayments.findMany({
        where: eq(qbPayments.facilityId, facilityId),
        columns: {
          id: true,
          paymentDate: true,
          checkNum: true,
          amountCents: true,
          memo: true,
          invoiceRef: true,
        },
        orderBy: [desc(qbPayments.paymentDate)],
      }),
    ])

    if (!facility) return Response.json({ error: 'Not found' }, { status: 404 })

    const html = buildFacilityStatementHtml({
      facilityName: facility.name ?? '',
      facilityCode: facility.facilityCode ?? null,
      address: facility.address ?? null,
      outstandingCents: facility.qbOutstandingBalanceCents ?? 0,
      paymentType: facility.paymentType,
      revShareType: facility.qbRevShareType ?? null,
      invoices: invoiceList,
      residents: residentList,
      payments: paymentList,
    })

    await sendEmail({
      to,
      subject: `Statement of Account — ${facility.name ?? facilityId}`,
      html,
    })

    await db
      .update(qbInvoices)
      .set({ lastSentAt: new Date(), sentVia: 'resend' })
      .where(eq(qbInvoices.facilityId, facilityId))

    return Response.json({ data: { sent: true } })
  } catch (err) {
    console.error('[billing/send-statement/facility] error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
