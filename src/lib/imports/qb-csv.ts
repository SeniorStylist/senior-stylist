// QuickBooks CSV export parsers — pure functions, no DB access.
// Shared by the three /api/super-admin/qb-import/* routes and scripts/validate-qb-csv.ts.
//
// Supported QB Online exports (exact report names):
//   1. "Customer Contact List"            → parseContactListCsv
//   2. "Invoice List by Date"             → parseInvoiceListCsv
//   3. "Invoices and Received Payments"   → parseGroupedTransactionsCsv (format: received_payments)
//   4. "Transaction List by Customer"     → parseGroupedTransactionsCsv (format: transaction_list)

import Papa from 'papaparse'

// ── Generic helpers ─────────────────────────────────────────────────────────

export function parseCents(val: string | undefined): number {
  const n = parseFloat((val ?? '').replace(/,/g, '').trim())
  return isNaN(n) ? 0 : Math.round(n * 100)
}

/** "MM/DD/YYYY" → "YYYY-MM-DD" (null when unparseable) */
export function parseQBDate(val: string | undefined): string | null {
  const m = (val ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, mo, dd, yyyy] = m
  return `${yyyy}-${mo.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

export function chunkArr<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Extract leading facility code: "F123 - Name" | "F123:..." | "F123" → "F123" */
export function extractFCode(name: string): string | null {
  const m = /^(F\d+)(?:\s*[-:]|\s|$)/.exec(name.trim())
  return m ? m[1] : null
}

/** Parse "Last, First - Room" (room optional, spacing inconsistent) into display name + room. */
export function parseResidentKey(raw: string): { name: string; room: string | null } {
  const trimmed = raw.trim()
  // Room separator: " - 230", " -240", "-125A" — a dash followed by an alnum room token at the end
  const dashMatch = /^(.*?)\s*-\s*([A-Za-z]?\d+\s?[A-Za-z]?)$/.exec(trimmed)
  const namePart = dashMatch ? dashMatch[1].trim() : trimmed
  const room = dashMatch ? dashMatch[2].trim() : null
  if (namePart.includes(', ')) {
    const commaIdx = namePart.indexOf(', ')
    const last = namePart.slice(0, commaIdx)
    const first = namePart.slice(commaIdx + 2)
    return { name: `${first.trim()} ${last.trim()}`, room }
  }
  return { name: namePart, room }
}

/** First US phone number in a QB phone cell ("Phone:(410) 415-7406 Mobile:...") */
export function extractFirstPhone(raw: string | undefined): string | null {
  const m = (raw ?? '').match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)
  return m ? m[0].trim() : null
}

/** "C/O Glenda Perry    email@x.com" → { poaName: "Glenda Perry", remainder } */
export function parseCareOf(raw: string | undefined): { poaName: string | null; address: string | null } {
  const cleaned = (raw ?? '').replace(/\S+@\S+/g, '').replace(/\s{2,}/g, ' ').trim()
  if (!cleaned) return { poaName: null, address: null }
  const m = /^c\/o\s+(.+)$/i.exec(cleaned)
  if (m) return { poaName: m[1].trim() || null, address: null }
  return { poaName: null, address: cleaned }
}

function parseRows(text: string): string[][] {
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false })
  return parsed.data
}

function isTotalRow(name: string): boolean {
  return /^total\b/i.test(name.trim())
}

// QB exports include a report-generation timestamp row, e.g. "Friday, June 12, 2026 07:33 AM GMTZ"
function isTimestampRow(name: string): boolean {
  return /^\w+day,\s+\w+\s+\d+,\s+\d{4}/i.test(name.trim())
}

// ── 1. Customer Contact List ────────────────────────────────────────────────

export interface ContactResidentRow {
  /** Full QB customer key, e.g. "F123:Acors, Bernice -125A" — matches residents.qb_customer_id */
  qbCustomerId: string
  fCode: string
  name: string
  room: string | null
  phone: string | null
  email: string | null
  poaName: string | null
  poaAddress: string | null
}

export interface ContactFacilityRow {
  fCode: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
}

export interface ContactListParse {
  residents: ContactResidentRow[]
  facilities: ContactFacilityRow[]
  skipped: number
}

export function parseContactListCsv(text: string): ContactListParse {
  const rows = parseRows(text)
  const headerIdx = rows.findIndex((r) => (r[0] ?? '').trim() === 'Customer full name')
  const residents: ContactResidentRow[] = []
  const facilities: ContactFacilityRow[] = []
  let skipped = 0
  if (headerIdx < 0) return { residents, facilities, skipped }

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    const name = (row?.[0] ?? '').trim()
    if (!name || isTotalRow(name)) continue

    const phone = extractFirstPhone(row[1])
    const email = (row[2] ?? '').trim() || null
    const billAddress = (row[4] ?? '').trim()

    if (name.includes(':')) {
      // Resident: "F123:Acors, Bernice -125A" (sometimes "F123 - Facility Name:Last, First - Room")
      const fCode = extractFCode(name)
      if (!fCode) { skipped++; continue }
      const residentPart = name.slice(name.lastIndexOf(':') + 1).trim()
      const { name: parsedName, room } = parseResidentKey(residentPart)
      if (!parsedName) { skipped++; continue }
      const { poaName, address } = parseCareOf(billAddress)
      residents.push({ qbCustomerId: name, fCode, name: parsedName, room, phone, email, poaName, poaAddress: address })
    } else {
      const fCode = extractFCode(name)
      if (fCode) {
        // Facility: "F120 - Arden Court of Pikesville #344" or bare "F122"
        const facName = name.includes('-') ? name.slice(name.indexOf('-') + 1).trim() : ''
        facilities.push({ fCode, name: facName, phone, email, address: billAddress || null })
      } else {
        skipped++ // standalone customer with no facility context (e.g. "Dave G")
      }
    }
  }
  return { residents, facilities, skipped }
}

// ── 2. Invoice List by Date ─────────────────────────────────────────────────

export interface InvoiceListRow {
  /** Customer key from the Name column — facility ("F120 - …") or resident ("F153:Last, First - Room") */
  customerName: string
  fCode: string | null
  invoiceNum: string
  invoiceDate: string
  dueDate: string | null
  amountCents: number
  openBalanceCents: number
}

export function parseInvoiceListCsv(text: string): { invoices: InvoiceListRow[]; skipped: number; allDates: boolean } {
  const rows = parseRows(text)
  const headerIdx = rows.findIndex((r) => (r[0] ?? '').trim() === 'Date' && r.some((c) => c.trim() === 'Transaction type'))
  const invoices: InvoiceListRow[] = []
  let skipped = 0
  if (headerIdx < 0) return { invoices, skipped, allDates: false }

  // QB writes the report's date range above the header ("All Dates" when unbounded).
  // A full export is authoritative — the route uses this to zero stale open balances.
  const allDates = rows.slice(0, headerIdx).some((r) => r.some((c) => (c ?? '').trim() === 'All Dates'))

  const header = rows[headerIdx].map((c) => c.trim())
  const col = (label: string) => header.indexOf(label)
  const cDate = col('Date'), cType = col('Transaction type'), cNum = col('Num'), cName = col('Name')
  const cDue = col('Due date'), cAmount = col('Amount'), cOpen = col('Open balance')

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length < 2) continue
    if ((row[cType] ?? '').trim() !== 'Invoice') { if ((row[cDate] ?? '').trim()) skipped++; continue }
    const invoiceDate = parseQBDate(row[cDate])
    const invoiceNum = (row[cNum] ?? '').trim()
    const customerName = (row[cName] ?? '').trim()
    if (!invoiceDate || !invoiceNum || !customerName) { skipped++; continue }
    invoices.push({
      customerName,
      fCode: extractFCode(customerName),
      invoiceNum,
      invoiceDate,
      dueDate: parseQBDate(row[cDue]),
      amountCents: parseCents(row[cAmount]),
      openBalanceCents: parseCents(row[cOpen]),
    })
  }
  return { invoices, skipped, allDates }
}

/** Status derivation shared with the QB live-sync engine's convention. */
export function deriveInvoiceStatus(amountCents: number, openCents: number): string {
  if (openCents === 0) return 'paid'
  if (openCents < 0) return 'credit'
  if (openCents < amountCents) return 'partial'
  return 'open'
}

// ── 3+4. Grouped customer transactions ──────────────────────────────────────
// Both "Invoices and Received Payments" and "Transaction List by Customer" group rows
// under customer header lines (customer name in col 0, transaction rows below with col 0 empty).

export type GroupedFormat = 'received_payments' | 'transaction_list'

export interface GroupedTxn {
  date: string
  type: string
  memo: string | null
  /** Invoice/transaction number when present (e.g. "0409 Aaron") */
  refNum: string | null
  amountCents: number
}

export interface CustomerSection {
  raw: string
  kind: 'facility' | 'resident_qbid' | 'resident_name'
  fCode: string | null
  /** Set for resident_qbid sections — the full "F123:Last, First - Room" key */
  qbCustomerId: string | null
  /** Set for resident sections — parsed display name + room for matching */
  residentKey: { name: string; room: string | null } | null
  txns: GroupedTxn[]
}

export function parseGroupedTransactionsCsv(text: string): { format: GroupedFormat; sections: CustomerSection[] } | null {
  const rows = parseRows(text)
  let headerIdx = -1
  let format: GroupedFormat | null = null
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].map((c) => c.trim())
    if (!cells.includes('Date') || !cells.includes('Transaction type')) continue
    headerIdx = i
    format = cells.includes('Posting (Y/N)') ? 'transaction_list' : 'received_payments'
    break
  }
  if (headerIdx < 0 || !format) return null

  const header = rows[headerIdx].map((c) => c.trim())
  const cDate = header.indexOf('Date')
  const cType = header.indexOf('Transaction type')
  const cAmount = header.indexOf('Amount')
  const cMemo = format === 'transaction_list' ? header.indexOf('Memo') : header.indexOf('Memo/Description')
  const cRef = format === 'transaction_list' ? header.indexOf('Num') : header.indexOf('Transaction number')

  const sections: CustomerSection[] = []
  const byRaw = new Map<string, CustomerSection>() // QB sometimes repeats the same header consecutively
  let current: CustomerSection | null = null

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue
    const col0 = (row[0] ?? '').trim()

    if (col0) {
      if (isTotalRow(col0)) { current = null; continue }
      if (isTimestampRow(col0)) { current = null; continue }
      const existing = byRaw.get(col0)
      if (existing) { current = existing; continue }
      const fCode = extractFCode(col0)
      let section: CustomerSection
      if (col0.includes(':') && fCode) {
        const residentPart = col0.slice(col0.lastIndexOf(':') + 1).trim()
        section = { raw: col0, kind: 'resident_qbid', fCode, qbCustomerId: col0, residentKey: parseResidentKey(residentPart), txns: [] }
      } else if (fCode) {
        section = { raw: col0, kind: 'facility', fCode, qbCustomerId: null, residentKey: null, txns: [] }
      } else {
        section = { raw: col0, kind: 'resident_name', fCode: null, qbCustomerId: null, residentKey: parseResidentKey(col0), txns: [] }
      }
      byRaw.set(col0, section)
      sections.push(section)
      current = section
      continue
    }

    if (!current) continue
    const type = (row[cType] ?? '').trim()
    const date = parseQBDate(row[cDate])
    if (!type || !date) continue
    const amountCents = parseCents(row[cAmount])
    current.txns.push({
      date,
      type,
      memo: cMemo >= 0 ? (row[cMemo] ?? '').trim() || null : null,
      refNum: cRef >= 0 ? (row[cRef] ?? '').trim() || null : null,
      amountCents,
    })
  }
  return { format, sections }
}

/** Extract a check number from a payment memo ("CK #1234", "Check 567") */
export function extractCheckNum(memo: string | null): string | null {
  if (!memo) return null
  const m = memo.match(/(?:CK|CHK|CHECK)\s*#?\s*(\w+)/i)
  return m ? m[1] : null
}

// ── 5. Customer Balance Detail ──────────────────────────────────────────────
// Hierarchical sections: facility ("F120 - Name" or bare "F123") → optional
// resident sub-sections ("Last, First - Room") → transaction rows (col 0 empty).
// Unapplied credits = non-Invoice rows with a nonzero open balance — payments and
// credit memos QB received but never applied to an invoice. These reduce QB's A/R
// total but are invisible to the Invoice List export.

export interface UnappliedCreditRow {
  fCode: string
  /** Resident sub-section header ("Last, First - Room"); null = facility-level payment */
  subCustomer: string | null
  txnType: string
  txnDate: string
  num: string | null
  /** Original payment amount (positive magnitude) */
  amountCents: number
  /** Unapplied portion still open (positive magnitude) */
  openBalanceCents: number
}

export function parseCustomerBalanceDetailCsv(text: string): { credits: UnappliedCreditRow[]; skipped: number } {
  const rows = parseRows(text)
  const headerIdx = rows.findIndex(
    (r) => (r[1] ?? '').trim() === 'Date' && r.some((c) => (c ?? '').trim() === 'Open balance')
  )
  const credits: UnappliedCreditRow[] = []
  let skipped = 0
  if (headerIdx < 0) return { credits, skipped }

  const header = rows[headerIdx].map((c) => (c ?? '').trim())
  const col = (label: string) => header.indexOf(label)
  const cDate = col('Date'), cType = col('Transaction type'), cNum = col('Num')
  const cAmount = col('Amount'), cOpen = col('Open balance')

  let fCode: string | null = null
  let sub: string | null = null

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const c0 = (row[0] ?? '').trim()
    if (c0) {
      if (isTimestampRow(c0)) continue
      if (isTotalRow(c0)) {
        // "Total for <resident>" closes the sub-section only; "Total for F1xx …"
        // and the grand "TOTAL" close the facility section too.
        const target = c0.replace(/^total for\s*/i, '')
        if (extractFCode(target) || /^total$/i.test(c0)) { fCode = null; sub = null }
        else sub = null
        continue
      }
      const code = extractFCode(c0)
      if (code) { fCode = code; sub = null }
      else if (fCode) sub = c0
      else skipped++ // sub-customer under an unrecognized parent section
      continue
    }
    const txnType = (row[cType] ?? '').trim()
    if (!txnType) continue
    if (txnType === 'Invoice') continue // open invoices come from the Invoice List import
    const openCents = parseCents(row[cOpen])
    if (openCents === 0) continue // fully applied — nothing outstanding
    const txnDate = parseQBDate(row[cDate])
    if (!fCode || !txnDate) { skipped++; continue }
    credits.push({
      fCode,
      subCustomer: sub,
      txnType,
      txnDate,
      num: (row[cNum] ?? '').trim() || null,
      amountCents: Math.abs(parseCents(row[cAmount])),
      openBalanceCents: Math.abs(openCents),
    })
  }
  return { credits, skipped }
}
