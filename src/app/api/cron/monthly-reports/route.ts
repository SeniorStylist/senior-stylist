// Phase 16 G4 — auto-emailed monthly facility statements. Runs on the 1st of the
// month (vercel.json `0 13 1 * *`) and emails each opted-in facility's statement
// of account to its contactEmail — the same document the manual "Send Statement"
// button produces, assembled the same way.
//
// Safety: capped at 25 facilities per run (the statement assembly is 4 queries per
// facility — bounded by the cap, acceptable on the max:1 pool for a monthly job);
// facilities whose invoices were statement-stamped within the last 20 days are
// skipped, so a manual re-trigger of the cron can't double-send.

import { db } from '@/db'
import { facilities, residents, qbInvoices, qbPayments } from '@/db/schema'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { sendEmail, buildFacilityStatementHtml } from '@/lib/email'
import { ensureMonthlyReportSchema } from '@/lib/monthly-report-ddl'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const MAX_PER_RUN = 25
const DEDUP_DAYS = 20

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await ensureMonthlyReportSchema()

    const optedIn = await db.query.facilities.findMany({
      where: and(
        eq(facilities.active, true),
        eq(facilities.isDemo, false),
        eq(facilities.monthlyReportEnabled, true),
        isNotNull(facilities.contactEmail),
      ),
      columns: {
        id: true,
        name: true,
        facilityCode: true,
        address: true,
        paymentType: true,
        contactEmail: true,
        qbOutstandingBalanceCents: true,
        qbRevShareType: true,
      },
      limit: MAX_PER_RUN,
    })

    let sent = 0
    let skippedRecent = 0
    let failed = 0

    for (const facility of optedIn) {
      try {
        // Dedup — a statement (manual or cron) was sent recently for this facility.
        const recent = await db
          .select({ lastSentAt: qbInvoices.lastSentAt })
          .from(qbInvoices)
          .where(and(eq(qbInvoices.facilityId, facility.id), isNotNull(qbInvoices.lastSentAt)))
          .orderBy(desc(qbInvoices.lastSentAt))
          .limit(1)
        if (recent[0]?.lastSentAt) {
          const cutoff = new Date(Date.now() - DEDUP_DAYS * 24 * 60 * 60 * 1000)
          if (new Date(recent[0].lastSentAt as unknown as string | Date) > cutoff) {
            skippedRecent++
            continue
          }
        }

        // Same assembly as the manual send-statement route.
        const [residentList, invoiceList, paymentList] = await Promise.all([
          db.query.residents.findMany({
            where: and(eq(residents.facilityId, facility.id), eq(residents.active, true)),
            columns: { id: true, name: true, roomNumber: true, qbOutstandingBalanceCents: true },
            orderBy: (t, { asc }) => [asc(t.name)],
          }),
          db.query.qbInvoices.findMany({
            where: eq(qbInvoices.facilityId, facility.id),
            columns: { id: true, residentId: true, invoiceNum: true, invoiceDate: true, amountCents: true, openBalanceCents: true, status: true },
            orderBy: [desc(qbInvoices.invoiceDate)],
          }),
          db.query.qbPayments.findMany({
            where: eq(qbPayments.facilityId, facility.id),
            columns: { id: true, paymentDate: true, checkNum: true, amountCents: true, memo: true, invoiceRef: true },
            orderBy: [desc(qbPayments.paymentDate)],
          }),
        ])

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

        // Awaited — a cron's whole job is the send.
        const ok = await sendEmail({
          to: facility.contactEmail!,
          subject: `Monthly Statement — ${facility.name}`,
          html,
        })
        if (ok) {
          sent++
          await db
            .update(qbInvoices)
            .set({ lastSentAt: new Date(), sentVia: 'resend' })
            .where(eq(qbInvoices.facilityId, facility.id))
        } else {
          failed++
        }
      } catch (err) {
        failed++
        console.error(`[monthly-reports] facility ${facility.id} failed:`, err)
      }
    }

    return Response.json({ data: { optedIn: optedIn.length, sent, skippedRecent, failed } })
  } catch (err) {
    console.error('GET /api/cron/monthly-reports error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
