import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, qbInvoices, qbPayments } from '@/db/schema'
import { eq, isNotNull, sql } from 'drizzle-orm'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import Papa from 'papaparse'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

function parseCents(val: string): number {
  const n = parseFloat((val ?? '').replace(/,/g, '').trim())
  return isNaN(n) ? 0 : Math.round(n * 100)
}

function parseQBDate(val: string): string | null {
  const m = val.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, mo, dd, yyyy] = m
  return `${yyyy}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function POST(request: Request) {
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
  const invoicesFile = formData.get('invoices') as File | null
  const transactionsFile = formData.get('transactions') as File | null

  if (!invoicesFile && !transactionsFile) {
    return Response.json({ error: 'At least one file (invoices or transactions) is required' }, { status: 400 })
  }

  // Bulk-fetch facility map: qbCustomerId → facilityId
  const facilityRows = await db.select({ id: facilities.id, qbCustomerId: facilities.qbCustomerId, facilityCode: facilities.facilityCode })
    .from(facilities)
    .where(isNotNull(facilities.qbCustomerId))
  const facilityMap = new Map<string, string>()
  for (const f of facilityRows) {
    if (f.qbCustomerId) facilityMap.set(f.qbCustomerId, f.id)
    if (f.facilityCode) facilityMap.set(f.facilityCode, f.id)
  }

  // Bulk-fetch resident map: qbCustomerId → residentId
  const residentRows = await db.select({ id: residents.id, qbCustomerId: residents.qbCustomerId })
    .from(residents)
    .where(isNotNull(residents.qbCustomerId))
  const residentMap = new Map<string, string>()
  for (const r of residentRows) {
    if (r.qbCustomerId) residentMap.set(r.qbCustomerId, r.id)
  }

  const warnings: string[] = []
  let invoicesCreated = 0
  let invoicesUpdated = 0
  let paymentsCreated = 0
  let paymentsSkipped = 0

  // ── Invoice List CSV ──────────────────────────────────────────────────────
  if (invoicesFile) {
    const rawText = await invoicesFile.text()
    const lines = rawText.split('\n')
    const headerIdx = lines.findIndex(l => l.trimStart().startsWith('Date,'))
    const csvText = headerIdx >= 0 ? lines.slice(headerIdx).join('\n') : rawText
    const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })

    type InvoiceRow = {
      facilityId: string
      residentId: string | null
      qbCustomerId: string
      invoiceNum: string
      invoiceDate: string
      dueDate: string | null
      amountCents: number
      openBalanceCents: number
      status: string
    }

    const toUpsert: InvoiceRow[] = []

    for (const row of parsed.data) {
      const dateVal = (row['Date'] ?? '').trim()
      if (!dateVal || !/^\d/.test(dateVal)) continue
      if ((row['Transaction type'] ?? '').trim() !== 'Invoice') continue

      const invoiceDate = parseQBDate(dateVal)
      if (!invoiceDate) continue

      const invoiceNum = (row['Num'] ?? '').trim()
      if (!invoiceNum) continue

      const nameVal = (row['Name'] ?? '').trim()
      if (!nameVal) continue

      // Derive facilityId from the Name column
      let facilityId: string | undefined
      let fCode: string

      if (nameVal.includes(':')) {
        fCode = nameVal.split(':')[0].trim()
      } else {
        fCode = nameVal
      }

      // Try exact qbCustomerId match first, then facilityCode match
      facilityId = facilityMap.get(fCode) ?? facilityMap.get(nameVal)
      if (!facilityId) {
        // Try extracting F-code prefix (e.g. "F123")
        const fMatch = fCode.match(/^(F\d+)/i)
        if (fMatch) facilityId = facilityMap.get(fMatch[1])
      }

      if (!facilityId) {
        warnings.push(`Invoice ${invoiceNum}: facility not found for "${fCode}"`)
        continue
      }

      const residentId = residentMap.get(nameVal) ?? null

      const amountCents = parseCents(row['Amount'] ?? '')
      const openBalanceCents = parseCents(row['Open balance'] ?? '')

      let status: string
      if (openBalanceCents === 0) status = 'paid'
      else if (openBalanceCents < 0) status = 'credit'
      else if (openBalanceCents < amountCents) status = 'partial'
      else status = 'open'

      const dueDateRaw = (row['Due date'] ?? '').trim()
      const dueDate = dueDateRaw ? parseQBDate(dueDateRaw) : null

      toUpsert.push({
        facilityId,
        residentId,
        qbCustomerId: nameVal,
        invoiceNum,
        invoiceDate,
        dueDate,
        amountCents,
        openBalanceCents,
        status,
      })
    }

    // Dedup by (invoiceNum, facilityId) — last wins
    const deduped = new Map<string, InvoiceRow>()
    for (const r of toUpsert) deduped.set(`${r.invoiceNum}__${r.facilityId}`, r)
    const finalRows = Array.from(deduped.values())

    for (const ch of chunk(finalRows, 100)) {
      const result = await db.insert(qbInvoices).values(ch.map(r => ({
        facilityId: r.facilityId,
        residentId: r.residentId,
        qbCustomerId: r.qbCustomerId,
        invoiceNum: r.invoiceNum,
        invoiceDate: r.invoiceDate,
        dueDate: r.dueDate,
        amountCents: r.amountCents,
        openBalanceCents: r.openBalanceCents,
        status: r.status,
      }))).onConflictDoUpdate({
        target: [qbInvoices.invoiceNum, qbInvoices.facilityId],
        set: {
          openBalanceCents: sql`excluded.open_balance_cents`,
          status: sql`excluded.status`,
          residentId: sql`excluded.resident_id`,
          qbCustomerId: sql`excluded.qb_customer_id`,
          updatedAt: new Date(),
        },
      }).returning({ id: qbInvoices.id, invoiceNum: qbInvoices.invoiceNum })

      // Count created vs updated by checking if createdAt ≈ updatedAt
      // Simpler: all rows in chunk went through — track by checking if we got back same count
      invoicesCreated += result.length
    }
    // We can't easily distinguish created vs updated from onConflictDoUpdate, use total
    invoicesUpdated = 0 // stats are combined in invoicesCreated for now
  }

  // ── Transaction List CSV ──────────────────────────────────────────────────
  if (transactionsFile) {
    const rawText = await transactionsFile.text()
    const txnLines = rawText.split('\n')
    const txnHeaderLineIdx = txnLines.findIndex(l => l.includes(',Date,') && l.includes('Transaction type'))
    const csvText = txnHeaderLineIdx >= 0 ? txnLines.slice(txnHeaderLineIdx).join('\n') : rawText
    const parsed = Papa.parse<string[]>(csvText, { header: false, skipEmptyLines: false })
    const rows = parsed.data

    // Find header row: first row with both "Date" and "Transaction type"
    let headerIdx = -1
    let colDate = -1, colTxnType = -1, colAmount = -1, colMemo = -1, colNum = -1

    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i]
      const dateIdx = row.findIndex(c => c.trim() === 'Date')
      const txnIdx = row.findIndex(c => c.trim() === 'Transaction type' || c.trim() === 'Transaction Type')
      if (dateIdx >= 0 && txnIdx >= 0) {
        headerIdx = i
        colDate = dateIdx
        colTxnType = txnIdx
        colAmount = row.findIndex(c => /^amount$/i.test(c.trim()))
        colMemo = row.findIndex(c => /^memo$/i.test(c.trim()))
        colNum = row.findIndex(c => /^num$/i.test(c.trim()))
        break
      }
    }

    if (headerIdx < 0) {
      warnings.push('Transactions CSV: could not find header row')
    } else {
      type PaymentRow = {
        facilityId: string
        residentId: string | null
        qbCustomerId: string | null
        paymentDate: string
        amountCents: number
        memo: string | null
        invoiceRef: string | null
        checkNum: string | null
        recordedVia: string
      }

      const toInsert: PaymentRow[] = []
      let currentFacilityId: string | null = null

      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i]
        if (!row || row.length === 0) continue

        const col0 = (row[0] ?? '').trim()

        if (col0) {
          // Facility header row — extract F-code
          const fMatch = col0.match(/^(F\d+)/i)
          if (fMatch) {
            currentFacilityId = facilityMap.get(fMatch[1]) ?? null
          } else {
            currentFacilityId = facilityMap.get(col0) ?? null
          }
          continue
        }

        // Detail row
        if (!currentFacilityId) continue

        const txnType = colTxnType >= 0 ? (row[colTxnType] ?? '').trim() : ''
        if (txnType !== 'Payment') continue

        const dateRaw = colDate >= 0 ? (row[colDate] ?? '').trim() : ''
        const paymentDate = parseQBDate(dateRaw)
        if (!paymentDate) continue

        const amountRaw = colAmount >= 0 ? (row[colAmount] ?? '').trim() : ''
        const amountCents = Math.abs(parseCents(amountRaw))
        if (amountCents === 0) continue

        const memo = colMemo >= 0 ? (row[colMemo] ?? '').trim() || null : null
        const numRaw = colNum >= 0 ? (row[colNum] ?? '').trim() : ''
        const invoiceRef = numRaw || null

        // Extract check number from memo
        let checkNum: string | null = null
        if (memo) {
          const ckMatch = memo.match(/(?:CK|CHK|CHECK)\s*#?\s*(\w+)/i)
          if (ckMatch) checkNum = ckMatch[1]
        }
        if (!checkNum && numRaw) checkNum = numRaw

        toInsert.push({
          facilityId: currentFacilityId,
          residentId: null,
          qbCustomerId: null,
          paymentDate,
          amountCents,
          memo,
          invoiceRef,
          checkNum,
          recordedVia: 'qb_import',
        })
      }

      for (const ch of chunk(toInsert, 100)) {
        const before = paymentsCreated + paymentsSkipped
        await db.insert(qbPayments).values(ch.map(r => ({
          facilityId: r.facilityId,
          residentId: r.residentId,
          qbCustomerId: r.qbCustomerId,
          paymentDate: r.paymentDate,
          amountCents: r.amountCents,
          memo: r.memo,
          invoiceRef: r.invoiceRef,
          checkNum: r.checkNum,
          recordedVia: r.recordedVia,
        }))).onConflictDoNothing()
        paymentsCreated += ch.length
        void before
      }
    }
  }

  // ── Recompute outstanding balances ─────────────────────────────────────────
  await db.execute(sql`
    UPDATE facilities f
    SET qb_outstanding_balance_cents = COALESCE((
      SELECT SUM(open_balance_cents) FROM qb_invoices WHERE facility_id = f.id
    ), 0)
  `)
  await db.execute(sql`
    UPDATE residents r
    SET qb_outstanding_balance_cents = COALESCE((
      SELECT SUM(open_balance_cents) FROM qb_invoices WHERE resident_id = r.id
    ), 0)
  `)

  // Count updated facilities and residents
  const [facilitiesUpdated] = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM facilities WHERE qb_outstanding_balance_cents > 0
  `)
  const [residentsUpdated] = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt FROM residents WHERE qb_outstanding_balance_cents > 0
  `)

  return Response.json({
    data: {
      invoices: { total: invoicesCreated },
      payments: { total: paymentsCreated },
      facilitiesWithBalance: (facilitiesUpdated as { cnt: number }).cnt ?? 0,
      residentsWithBalance: (residentsUpdated as { cnt: number }).cnt ?? 0,
      warnings,
    },
  })
}
