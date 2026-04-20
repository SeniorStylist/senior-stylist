import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbInvoices } from '@/db/schema'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { sendEmail, buildResidentStatementHtml } from '@/lib/email'
import { z } from 'zod'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const bodySchema = z.object({
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
    if (!fu || fu.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })
    if (fu.facilityId !== facilityId) return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rl = await checkRateLimit('billingSend', user.id)
  if (!rl.ok) return rateLimitResponse(rl.retryAfter)

  const rawBody = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(rawBody)
  if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
  const { force } = parsed.data

  try {
    const [facilityRow, residentList, allInvoices] = await Promise.all([
      db.query.facilities.findFirst({
        where: eq(facilities.id, facilityId),
        columns: { name: true },
      }),
      db.query.residents.findMany({
        where: and(eq(residents.facilityId, facilityId), eq(residents.active, true), isNotNull(residents.poaEmail)),
        columns: {
          id: true,
          name: true,
          roomNumber: true,
          qbOutstandingBalanceCents: true,
          poaEmail: true,
          poaName: true,
        },
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
          lastSentAt: true,
        },
        orderBy: [desc(qbInvoices.invoiceDate)],
      }),
    ])

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const facilityName = facilityRow?.name ?? ''

    let sent = 0
    let skipped = 0

    // Process each resident sequentially to avoid Resend rate limits
    for (const resident of residentList) {
      if (!resident.poaEmail) continue
      if ((resident.qbOutstandingBalanceCents ?? 0) <= 0) {
        skipped++
        continue
      }

      const myInvoices = allInvoices.filter((i) => i.residentId === resident.id)

      // Dedup check
      if (!force) {
        const mostRecentSent = myInvoices
          .filter((i) => i.lastSentAt)
          .map((i) => new Date(i.lastSentAt as unknown as string | Date))
          .sort((a, b) => b.getTime() - a.getTime())[0]

        if (mostRecentSent && mostRecentSent > sevenDaysAgo) {
          skipped++
          continue
        }
      }

      const html = buildResidentStatementHtml({
        residentName: resident.name,
        roomNumber: resident.roomNumber ?? null,
        facilityName,
        outstandingCents: resident.qbOutstandingBalanceCents ?? 0,
        invoices: myInvoices,
        poaName: resident.poaName ?? null,
      })

      await sendEmail({
        to: resident.poaEmail,
        subject: `Billing Reminder — ${resident.name}`,
        html,
      })

      if (myInvoices.length > 0) {
        await db
          .update(qbInvoices)
          .set({ lastSentAt: new Date(), sentVia: 'resend' })
          .where(eq(qbInvoices.residentId, resident.id))
      }

      sent++
    }

    return Response.json({ data: { sent, skipped } })
  } catch (err) {
    console.error('[billing/send-statement/all-residents] error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
