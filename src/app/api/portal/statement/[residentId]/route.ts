import { db } from '@/db'
import { facilities, qbInvoices, residents } from '@/db/schema'
import { getPortalSession } from '@/lib/portal-auth'
import { buildResidentStatementHtml } from '@/lib/email'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { and, desc, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ residentId: string }> }) {
  try {
    const { residentId } = await params
    const session = await getPortalSession()
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('portalStatement', session.portalAccountId)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const residentMatch = session.residents.find((r) => r.residentId === residentId)
    if (!residentMatch) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, residentId),
      columns: { id: true, name: true, roomNumber: true, facilityId: true, poaName: true, qbOutstandingBalanceCents: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, resident.facilityId),
      columns: { id: true, name: true },
    })

    const invoices = await db
      .select({
        invoiceNum: qbInvoices.invoiceNum,
        invoiceDate: qbInvoices.invoiceDate,
        amountCents: qbInvoices.amountCents,
        openBalanceCents: qbInvoices.openBalanceCents,
        status: qbInvoices.status,
      })
      .from(qbInvoices)
      .where(and(eq(qbInvoices.residentId, residentId)))
      .orderBy(desc(qbInvoices.invoiceDate))
      .limit(50)

    const innerHtml = buildResidentStatementHtml({
      residentName: resident.name,
      roomNumber: resident.roomNumber,
      facilityName: facility?.name ?? '',
      outstandingCents: resident.qbOutstandingBalanceCents ?? 0,
      invoices: invoices.map((i) => ({
        invoiceNum: i.invoiceNum,
        invoiceDate: i.invoiceDate,
        amountCents: i.amountCents,
        openBalanceCents: i.openBalanceCents,
        status: i.status,
      })),
      poaName: resident.poaName,
    })

    const slug = resident.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'resident'
    const today = new Date()
    const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

    const wrapped = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Statement — ${resident.name}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; background: #F5F5F4; }
    .topbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #E7E5E4; padding: 12px 16px; display: flex; gap: 12px; align-items: center; justify-content: space-between; z-index: 10; }
    .topbar .left { font-size: 13px; color: #57534E; }
    .topbar a { color: #8B2E4A; text-decoration: none; font-size: 13px; font-weight: 600; }
    .print-btn { background: #8B2E4A; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
    @media print {
      .topbar { display: none; }
      body { background: #fff; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="left">Statement for ${resident.name}</div>
    <button class="print-btn" onclick="window.print()">Print or Save as PDF</button>
  </div>
  ${innerHtml}
</body>
</html>`

    return new Response(wrapped, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="statement-${slug}-${ymd}.html"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('GET /api/portal/statement/[residentId] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
