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
  /**
   * P48 — did the sync make real forward progress (cursor moved)? This, not
   * `errors.length`, is the signal callers should treat as success/failure:
   * a safety-cap run reports an error yet still advanced, while a token
   * failure reports an error and did NOT.
   */
  cursorAdvanced: boolean
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
  const result: SyncQBInvoicesResult = { created: 0, updated: 0, skipped: 0, errors: [], cursorAdvanced: false }
  // Per-row upsert failures: they mean the window was NOT fully ingested, so
  // the cursor must not move past it (see the guarded update at the end).
  let writeFailures = 0
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

  // P48 — track WHY the loop ended. The cursor may only move forward over a
  // window we actually ingested; see the guarded update at the end.
  let fetchFailed = false
  let capped = false

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
      fetchFailed = true
      break
    }
    const page = res.QueryResponse?.Invoice ?? []
    allInvoices.push(...page)
    if (page.length < PAGE_SIZE) break
    startPosition += PAGE_SIZE
    if (allInvoices.length >= SAFETY_CAP) {
      result.errors.push(`Stopped at ${SAFETY_CAP} invoices — re-sync to continue`)
      capped = true
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
          target: [qbInvoices.invoiceNum, qbInvoices.facilityId, qbInvoices.invoiceDate],
          set: {
            residentId: sql`excluded.resident_id`,
            qbCustomerId: sql`excluded.qb_customer_id`,
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
      writeFailures++
    }
  }

  // Balance recomputes are derived from whatever is now in our DB, so they are
  // always safe to run — even after a partial pull.
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

  /**
   * P48 — THE CURSOR MAY ONLY MOVE OVER A WINDOW WE ACTUALLY INGESTED.
   *
   * This block used to run unconditionally. An expired refresh token throws
   * inside qbGet, is caught by the pagination loop above, and execution fell
   * straight through to here — stamping the cursor to now() even though zero
   * invoices were pulled. The next incremental run then asked for
   * `LastUpdatedTime > <the failed run>` and silently skipped every invoice
   * that changed during the outage. Manual use masked it (the operator saw an
   * error and clicked again); the nightly cron would have made it silent
   * recurring data loss.
   *
   * - query failed, or any row failed to write → do NOT advance (a later run
   *   must re-cover the same window)
   * - safety cap hit → advance only as far as the newest invoice we stored, so
   *   the next run RESUMES instead of either stalling on the same 5000 or
   *   skipping the remainder
   * - clean full pull → advance to now()
   */
  let nextCursor: string | null = null
  if (!fetchFailed && writeFailures === 0) {
    if (capped) {
      const newest = allInvoices.reduce<string | null>((max, inv) => {
        const t = inv.MetaData?.LastUpdatedTime
        return t && (!max || t > max) ? t : max
      }, null)
      nextCursor = newest // null → stay put rather than guess
    } else {
      nextCursor = new Date().toISOString()
    }
  }

  if (nextCursor) {
    await db
      .update(facilities)
      .set({
        // Only stamped alongside real forward progress, so "Last synced" on the
        // billing page and the master QB dashboard stays truthful.
        qbInvoicesLastSyncedAt: new Date(),
        qbInvoicesSyncCursor: nextCursor,
        updatedAt: new Date(),
      })
      .where(eq(facilities.id, facilityId))
  }
  result.cursorAdvanced = !!nextCursor

  return result
}
