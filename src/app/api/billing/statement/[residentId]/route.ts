// P42 — printable resident statement for BILLING STAFF (the assistant's
// create_statement links land here; also linkable from anywhere). GET-only:
// renders inline printable HTML via buildResidentStatementHtml — it never
// sends anything (statement SENDING stays in the Billing UI with its
// confirm gates). Guard mirrors send-statement/resident: master OR
// canAccessBilling + same facility.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbInvoices } from '@/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { buildResidentStatementHtml } from '@/lib/email'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ residentId: string }> },
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

  try {
    const resident = await db.query.residents.findFirst({
      where: and(eq(residents.id, residentId), eq(residents.active, true)),
      columns: { id: true, name: true, roomNumber: true, facilityId: true, poaName: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu || !canAccessBilling(fu.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (fu.facilityId !== resident.facilityId) return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [facilityRow, invoiceList] = await Promise.all([
      db.query.facilities.findFirst({
        where: eq(facilities.id, resident.facilityId),
        columns: { name: true },
      }),
      db.query.qbInvoices.findMany({
        where: and(eq(qbInvoices.residentId, residentId), eq(qbInvoices.isDemo, false)),
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

    // Live outstanding = SUM of the open balances actually shown (P40 rule —
    // never the stale denormalized resident column).
    const outstandingCents = invoiceList.reduce((s, i) => s + (i.openBalanceCents ?? 0), 0)

    const innerHtml = buildResidentStatementHtml({
      residentName: resident.name,
      roomNumber: resident.roomNumber ?? null,
      facilityName: facilityRow?.name ?? '',
      outstandingCents,
      invoices: invoiceList,
      poaName: resident.poaName ?? null,
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
    console.error('GET /api/billing/statement/[residentId] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
