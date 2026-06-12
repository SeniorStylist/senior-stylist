// QB "Invoice List by Date" CSV import — authoritative source for invoice history and
// open balances. Upserts qb_invoices on (invoice_num, facility_id, invoice_date) and
// recomputes facility + resident outstanding balances. Master admin only.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbInvoices } from '@/db/schema'
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { parseInvoiceListCsv, deriveInvoiceStatus, chunkArr } from '@/lib/imports/qb-csv'
import { revalidateTag } from 'next/cache'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const MAX_WARNINGS = 200

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!superAdminEmail || user.email !== superAdminEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('billingImport', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return Response.json({ error: 'No file provided' }, { status: 400 })

    const { invoices: parsedInvoices, skipped, allDates } = parseInvoiceListCsv(await file.text())
    if (parsedInvoices.length === 0) {
      return Response.json({ error: 'No invoice rows found — is this the QB "Invoice List by Date" export?' }, { status: 400 })
    }

    const warnings: string[] = []
    const warn = (msg: string) => { if (warnings.length < MAX_WARNINGS) warnings.push(msg) }

    // Lookup maps
    const facilityRows = await db.select({
      id: facilities.id,
      facilityCode: facilities.facilityCode,
      qbCustomerId: facilities.qbCustomerId,
    }).from(facilities)
    const facilityByCode = new Map<string, string>()
    for (const f of facilityRows) {
      if (f.facilityCode) facilityByCode.set(f.facilityCode, f.id)
      if (f.qbCustomerId && !facilityByCode.has(f.qbCustomerId)) facilityByCode.set(f.qbCustomerId, f.id)
    }

    const residentRows = await db.select({ id: residents.id, qbCustomerId: residents.qbCustomerId })
      .from(residents).where(isNotNull(residents.qbCustomerId))
    const residentByQbId = new Map<string, string>()
    for (const r of residentRows) {
      if (r.qbCustomerId) residentByQbId.set(r.qbCustomerId, r.id)
    }

    type InvoiceUpsert = {
      facilityId: string
      residentId: string | null
      qbCustomerId: string
      invoiceNum: string
      invoiceDate: string
      dueDate: string | null
      amountCents: number
      openBalanceCents: number
    }

    // QB sometimes emits two invoices with the same num + date (e.g. two services billed
    // separately) — aggregate them so totals stay exact under the unique key.
    const merged = new Map<string, InvoiceUpsert>()
    let facilityMisses = 0
    let residentMatched = 0
    let residentUnmatched = 0

    for (const inv of parsedInvoices) {
      const facilityId = inv.fCode ? facilityByCode.get(inv.fCode) : undefined
      if (!facilityId) {
        facilityMisses++
        warn(`Invoice ${inv.invoiceNum}: no facility for "${inv.customerName}"`)
        continue
      }
      const isResidentInvoice = inv.customerName.includes(':')
      const residentId = isResidentInvoice ? residentByQbId.get(inv.customerName) ?? null : null
      if (isResidentInvoice) {
        if (residentId) residentMatched++
        else { residentUnmatched++; warn(`Invoice ${inv.invoiceNum}: resident not found for "${inv.customerName}"`) }
      }

      const key = `${inv.invoiceNum}__${facilityId}__${inv.invoiceDate}`
      const existing = merged.get(key)
      if (existing) {
        existing.amountCents += inv.amountCents
        existing.openBalanceCents += inv.openBalanceCents
      } else {
        merged.set(key, {
          facilityId,
          residentId,
          qbCustomerId: inv.customerName,
          invoiceNum: inv.invoiceNum,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.dueDate,
          amountCents: inv.amountCents,
          openBalanceCents: inv.openBalanceCents,
        })
      }
    }
    const finalRows = Array.from(merged.values())

    // Pre-fetch existing keys so we can report created vs updated accurately
    const existingKeyRows = await db.select({
      invoiceNum: qbInvoices.invoiceNum,
      facilityId: qbInvoices.facilityId,
      invoiceDate: qbInvoices.invoiceDate,
    }).from(qbInvoices)
    const existingKeys = new Set(existingKeyRows.map((r) => `${r.invoiceNum}__${r.facilityId}__${r.invoiceDate}`))

    let created = 0
    let updated = 0
    for (const ch of chunkArr(finalRows, 100)) {
      await db.insert(qbInvoices).values(ch.map((r) => ({
        facilityId: r.facilityId,
        residentId: r.residentId,
        qbCustomerId: r.qbCustomerId,
        invoiceNum: r.invoiceNum,
        invoiceDate: r.invoiceDate,
        dueDate: r.dueDate,
        amountCents: r.amountCents,
        openBalanceCents: r.openBalanceCents,
        status: deriveInvoiceStatus(r.amountCents, r.openBalanceCents),
      }))).onConflictDoUpdate({
        target: [qbInvoices.invoiceNum, qbInvoices.facilityId, qbInvoices.invoiceDate],
        set: {
          amountCents: sql`excluded.amount_cents`,
          openBalanceCents: sql`excluded.open_balance_cents`,
          status: sql`excluded.status`,
          dueDate: sql`excluded.due_date`,
          // Never null-out a resident link made by the live QB sync or a prior import
          residentId: sql`COALESCE(excluded.resident_id, ${qbInvoices.residentId})`,
          qbCustomerId: sql`COALESCE(excluded.qb_customer_id, ${qbInvoices.qbCustomerId})`,
          updatedAt: new Date(),
        },
      })
      for (const r of ch) {
        if (existingKeys.has(`${r.invoiceNum}__${r.facilityId}__${r.invoiceDate}`)) updated++
        else created++
      }
    }

    // An "All Dates" export is the complete invoice universe for QB: any DB invoice
    // still carrying an open balance that ISN'T in the file is stale — voided/deleted
    // in QB, or a legacy-import duplicate whose date didn't match the 3-column key.
    // Zero them so the recomputed outstanding matches QB exactly. Scoped to facilities
    // present in the file so a foreign/partial dataset can never be mass-zeroed.
    let staleZeroed = 0
    let staleZeroedCents = 0
    if (allDates) {
      const coveredFacilityIds = Array.from(new Set(finalRows.map((r) => r.facilityId)))
      const openRows = coveredFacilityIds.length === 0 ? [] : await db.select({
        id: qbInvoices.id,
        invoiceNum: qbInvoices.invoiceNum,
        facilityId: qbInvoices.facilityId,
        invoiceDate: qbInvoices.invoiceDate,
        openBalanceCents: qbInvoices.openBalanceCents,
      }).from(qbInvoices).where(and(
        ne(qbInvoices.openBalanceCents, 0),
        eq(qbInvoices.isDemo, false),
        inArray(qbInvoices.facilityId, coveredFacilityIds),
      ))
      const staleIds = openRows
        .filter((r) => !merged.has(`${r.invoiceNum}__${r.facilityId}__${r.invoiceDate}`))
        .map((r) => { staleZeroedCents += r.openBalanceCents; return r.id })
      staleZeroed = staleIds.length
      for (const ch of chunkArr(staleIds, 500)) {
        await db.update(qbInvoices)
          .set({ openBalanceCents: 0, status: 'paid', updatedAt: new Date() })
          .where(inArray(qbInvoices.id, ch))
      }
    }

    // Recompute outstanding balances from the now-authoritative open balances
    await db.execute(sql`
      UPDATE facilities f
      SET qb_outstanding_balance_cents = COALESCE((
        SELECT SUM(open_balance_cents) FROM qb_invoices WHERE facility_id = f.id AND is_demo = false
      ), 0)
    `)
    await db.execute(sql`
      UPDATE residents r
      SET qb_outstanding_balance_cents = COALESCE((
        SELECT SUM(open_balance_cents) FROM qb_invoices WHERE resident_id = r.id AND is_demo = false
      ), 0)
    `)

    revalidateTag('billing', {})

    const totalOpenCents = finalRows.reduce((s, r) => s + r.openBalanceCents, 0)

    return Response.json({
      data: {
        created,
        updated,
        skippedRows: skipped + facilityMisses,
        residentMatched,
        residentUnmatched,
        totalOpenCents,
        staleZeroed,
        staleZeroedCents,
        warnings,
      },
    })
  } catch (err) {
    console.error('qb-import/invoices failed:', err)
    return Response.json({ error: 'Import failed — check file format and try again' }, { status: 500 })
  }
}
