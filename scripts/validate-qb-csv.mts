// Dev tool: dry-run the QB CSV parsers against real export files and print stats.
// Usage: node --experimental-strip-types scripts/validate-qb-csv.mts <contacts.csv> <invoices.csv> <payments.csv> [transactions.csv]
import { readFileSync } from 'fs'
import {
  parseContactListCsv,
  parseInvoiceListCsv,
  parseGroupedTransactionsCsv,
  deriveInvoiceStatus,
} from '../src/lib/imports/qb-csv.ts'

const [contactsPath, invoicesPath, paymentsPath, txnsPath] = process.argv.slice(2)

if (contactsPath) {
  const r = parseContactListCsv(readFileSync(contactsPath, 'utf8'))
  console.log('── Customer Contact List ──')
  console.log(`residents: ${r.residents.length}  facilities: ${r.facilities.length}  skipped: ${r.skipped}`)
  console.log('sample resident:', JSON.stringify(r.residents[1]))
  console.log('sample facility:', JSON.stringify(r.facilities[0]))
  const withEmail = r.residents.filter((x) => x.email).length
  const withPhone = r.residents.filter((x) => x.phone).length
  const withPoa = r.residents.filter((x) => x.poaName).length
  console.log(`with email: ${withEmail}  with phone: ${withPhone}  with poaName: ${withPoa}`)
}

if (invoicesPath) {
  const r = parseInvoiceListCsv(readFileSync(invoicesPath, 'utf8'))
  console.log('\n── Invoice List by Date ──')
  console.log(`invoices: ${r.invoices.length}  skipped: ${r.skipped}`)
  const noFCode = r.invoices.filter((x) => !x.fCode)
  console.log(`without fCode: ${noFCode.length}`, noFCode.slice(0, 3).map((x) => x.customerName))
  const statuses: Record<string, number> = {}
  let openCents = 0
  for (const inv of r.invoices) {
    const s = deriveInvoiceStatus(inv.amountCents, inv.openBalanceCents)
    statuses[s] = (statuses[s] ?? 0) + 1
    openCents += inv.openBalanceCents
  }
  console.log('statuses:', statuses, ` total open: $${(openCents / 100).toFixed(2)}`)
  const dupKeys = new Map<string, number>()
  for (const inv of r.invoices) {
    const k = `${inv.invoiceNum}__${inv.fCode}`
    dupKeys.set(k, (dupKeys.get(k) ?? 0) + 1)
  }
  const dups = [...dupKeys.entries()].filter(([, n]) => n > 1)
  console.log(`duplicate (invoiceNum, fCode) keys: ${dups.length}`, dups.slice(0, 5))
}

function summarizeGrouped(label: string, path: string) {
  const r = parseGroupedTransactionsCsv(readFileSync(path, 'utf8'))
  console.log(`\n── ${label} ──`)
  if (!r) { console.log('FAILED to detect format'); return }
  console.log(`format: ${r.format}  sections: ${r.sections.length}`)
  const kinds: Record<string, number> = {}
  const types: Record<string, number> = {}
  let payments = 0
  for (const s of r.sections) {
    kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
    for (const t of s.txns) {
      types[t.type] = (types[t.type] ?? 0) + 1
      if (t.type === 'Payment' || t.type === 'Sales Receipt') payments++
    }
  }
  console.log('section kinds:', kinds)
  console.log('txn types:', types)
  console.log(`importable payments: ${payments}`)
  const sample = r.sections.find((s) => s.kind === 'resident_name')
  console.log('sample resident_name section:', JSON.stringify({ raw: sample?.raw, key: sample?.residentKey, txns: sample?.txns.slice(0, 2) }))
  const facSample = r.sections.find((s) => s.kind === 'facility')
  console.log('sample facility section:', JSON.stringify({ raw: facSample?.raw, fCode: facSample?.fCode, txns: facSample?.txns.slice(0, 2) }))
}

if (paymentsPath) summarizeGrouped('Invoices and Received Payments', paymentsPath)
if (txnsPath) summarizeGrouped('Transaction List by Customer', txnsPath)
