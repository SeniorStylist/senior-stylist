import { db } from '@/db'
import { facilities, residents, qbInvoices } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { qbGet } from '@/lib/quickbooks'
import { fuzzyBestMatch } from '@/lib/fuzzy'

interface QBInvoice {
  Id: string
  DocNumber?: string
  TxnDate: string
  DueDate?: string
  TotalAmt: number
  Balance: number
  CustomerRef?: { value: string; name?: string }
  MetaData?: { CreateTime: string; LastUpdatedTime: string }
}

interface QBQueryResponse {
  QueryResponse: {
    Invoice?: QBInvoice[]
    startPosition?: number
    maxResults?: number
    totalCount?: number
  }
}

export interface SyncQBInvoicesResult {
  created: number
  updated: number
  skipped: number
  errors: string[]
}

function deriveStatus(amountCents: number, openBalanceCents: number): string {
  if (openBalanceCents === 0) return 'paid'
  if (openBalanceCents < 0) return 'credit'
  if (openBalanceCents < amountCents) return 'partial'
  return 'open'
}

function parseResidentName(qbCustomerName: string): string {
  const afterColon = qbCustomerName.includes(':')
    ? qbCustomerName.split(':').slice(1).join(':').trim()
    : qbCustomerName.trim()
  const beforeRoom = afterColon.split(' - ')[0].trim()
  if (beforeRoom.includes(', ')) {
    const [last, first] = beforeRoom.split(', ')
    return `${first.trim()} ${last.trim()}`
  }
  return beforeRoom
}

export async function syncQBInvoices(
  facilityId: string,
  options: { fullSync?: boolean } = {},
): Promise<SyncQBInvoicesResult> {
  const result: SyncQBInvoicesResult = { created: 0, updated: 0, skipped: 0, errors: [] }
  const { fullSync = false } = options

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { id: true, qbRealmId: true, qbInvoicesSyncCursor: true },
  })
  if (!facility?.qbRealmId) {
    throw new Error('QuickBooks not connected for this facility')
  }

  const residentList = await db.query.residents.findMany({
    where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
    columns: { id: true, name: true, qbCustomerId: true },
  })
  const residentByQbId = new Map<string, string>()
  for (const r of residentList) {
    if (r.qbCustomerId) residentByQbId.set(r.qbCustomerId, r.id)
  }

  const existingInvoices = await db.query.qbInvoices.findMany({
    where: eq(qbInvoices.facilityId, facilityId),
    columns: { invoiceNum: true, openBalanceCents: true, status: true, qbInvoiceId: true },
  })
  const existingByNum = new Map(existingInvoices.map((i) => [i.invoiceNum, i]))

  const cursor = fullSync ? null : (facility.qbInvoicesSyncCursor ?? null)
  const whereClause = cursor
    ? ` WHERE Metadata.LastUpdatedTime > '${cursor.replace(/'/g, "\\'")}'`
    : ''

  let startPosition = 1
  const PAGE_SIZE = 100
  const SAFETY_CAP = 5000
  const allInvoices: QBInvoice[] = []

  while (true) {
    const query = `SELECT * FROM Invoice${whereClause} STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
    const path = `/query?query=${encodeURIComponent(query)}&minorversion=65`
    let res: QBQueryResponse
    try {
      res = await qbGet<QBQueryResponse>(facilityId, path)
    } catch (err) {
      result.errors.push(
        `Query failed at position ${startPosition}: ${(err as Error).message?.slice(0, 200)}`,
      )
      break
    }
    const page = res.QueryResponse?.Invoice ?? []
    allInvoices.push(...page)
    if (page.length < PAGE_SIZE) break
    startPosition += PAGE_SIZE
    if (allInvoices.length >= SAFETY_CAP) {
      result.errors.push(`Stopped at ${SAFETY_CAP} invoices — re-sync to continue`)
      break
    }
  }

  for (const inv of allInvoices) {
    const invoiceNum = inv.DocNumber ?? inv.Id
    if (!invoiceNum) {
      result.errors.push(`Invoice ${inv.Id} missing DocNumber and Id — skipped`)
      continue
    }
    const amountCents = Math.round((inv.TotalAmt ?? 0) * 100)
    const openBalanceCents = Math.round((inv.Balance ?? 0) * 100)
    const status = deriveStatus(amountCents, openBalanceCents)
    const qbCustomerName = inv.CustomerRef?.name ?? ''

    let residentId: string | null = null
    if (qbCustomerName) {
      residentId = residentByQbId.get(qbCustomerName) ?? null
      if (!residentId) {
        const parsedName = parseResidentName(qbCustomerName)
        if (parsedName) {
          const match = fuzzyBestMatch(residentList, parsedName, 0.7)
          if (match) residentId = match.id
        }
      }
    }

    const existing = existingByNum.get(invoiceNum)
    if (
      existing &&
      existing.openBalanceCents === openBalanceCents &&
      existing.status === status &&
      existing.qbInvoiceId === inv.Id
    ) {
      result.skipped++
      continue
    }

    try {
      await db
        .insert(qbInvoices)
        .values({
          facilityId,
          residentId,
          qbCustomerId: qbCustomerName || null,
          invoiceNum,
          invoiceDate: inv.TxnDate,
          dueDate: inv.DueDate ?? null,
          amountCents,
          openBalanceCents,
          status,
          qbInvoiceId: inv.Id,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [qbInvoices.invoiceNum, qbInvoices.facilityId],
          set: {
            residentId: sql`excluded.resident_id`,
            qbCustomerId: sql`excluded.qb_customer_id`,
            invoiceDate: sql`excluded.invoice_date`,
            dueDate: sql`excluded.due_date`,
            amountCents: sql`excluded.amount_cents`,
            openBalanceCents: sql`excluded.open_balance_cents`,
            status: sql`excluded.status`,
            qbInvoiceId: sql`excluded.qb_invoice_id`,
            syncedAt: sql`excluded.synced_at`,
            updatedAt: new Date(),
          },
        })
      if (existing) result.updated++
      else result.created++
    } catch (err) {
      result.errors.push(`Invoice ${invoiceNum}: ${(err as Error).message?.slice(0, 200)}`)
    }
  }

  await db.execute(sql`
    UPDATE facilities SET qb_outstanding_balance_cents = COALESCE((
      SELECT SUM(open_balance_cents) FROM qb_invoices
      WHERE facility_id = ${facilityId} AND status != 'paid'
    ), 0) WHERE id = ${facilityId}
  `)

  await db.execute(sql`
    UPDATE residents SET qb_outstanding_balance_cents = COALESCE((
      SELECT SUM(open_balance_cents) FROM qb_invoices
      WHERE resident_id = residents.id AND status != 'paid'
    ), 0) WHERE facility_id = ${facilityId}
  `)

  await db
    .update(facilities)
    .set({
      qbInvoicesLastSyncedAt: new Date(),
      qbInvoicesSyncCursor: new Date().toISOString(),
      updatedAt: new Date(),
    })
    .where(eq(facilities.id, facilityId))

  return result
}
