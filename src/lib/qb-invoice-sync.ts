import { db } from '@/db'
import { facilities, residents, qbInvoices, qbCustomerLinks } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { qbGet, qbQuoteLiteral } from '@/lib/quickbooks'
import { fuzzyBestMatch } from '@/lib/fuzzy'
import { ensureQbLinksSchema } from '@/lib/qb-links-ddl'
import { customerBelongsToFacility, getFacilityQbScope } from '@/lib/qb-scope'
import { ensureQbSafetySchema } from '@/lib/qb-safety-ddl'
import { reapplySitePayments } from '@/lib/qb-site-payments'
import { recordSyncRun } from '@/lib/qb-runs'

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
  /** Non-fatal things a human should look at (e.g. invoices with payments on BOTH sides). */
  warnings: string[]
}

function deriveStatus(amountCents: number, openBalanceCents: number): string {
  if (openBalanceCents === 0) return 'paid'
  if (openBalanceCents < 0) return 'credit'
  if (openBalanceCents < amountCents) return 'partial'
  return 'open'
}

export function parseResidentName(qbCustomerName: string): string {
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

/** A realm-wide invoice pull that several facilities can apply (qb-realm-sync.ts). */
export interface PrefetchedInvoices {
  rows: QBInvoice[]
  fetchFailed: boolean
  capped: boolean
  errors: string[]
  /** Newest LastUpdatedTime across EVERY fetched row (before per-facility
   *  routing). A capped pull may advance a facility's cursor to here even when
   *  none of the fetched rows were its own — everything up to this instant was
   *  seen. */
  watermark: string | null
}

const PAGE_SIZE = 100
const SAFETY_CAP = 5000

/**
 * Pull every invoice changed after `cursor` (or everything when null), ordered
 * by LastUpdatedTime so a capped pull's newest row is a true watermark.
 * Facility-agnostic — the token is the realm's; callers scope the rows.
 */
export async function fetchQBInvoices(facilityId: string, cursor: string | null): Promise<PrefetchedInvoices> {
  const out: PrefetchedInvoices = { rows: [], fetchFailed: false, capped: false, errors: [], watermark: null }
  const whereClause = cursor ? ` WHERE Metadata.LastUpdatedTime > ${qbQuoteLiteral(cursor)}` : ''
  let startPosition = 1
  while (true) {
    const query = `SELECT * FROM Invoice${whereClause} ORDERBY Metadata.LastUpdatedTime ASC STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
    const path = `/query?query=${encodeURIComponent(query)}`
    let res: QBQueryResponse
    try {
      res = await qbGet<QBQueryResponse>(facilityId, path)
    } catch (err) {
      out.errors.push(`Query failed at position ${startPosition}: ${(err as Error).message?.slice(0, 200)}`)
      out.fetchFailed = true
      break
    }
    const page = res.QueryResponse?.Invoice ?? []
    out.rows.push(...page)
    if (page.length < PAGE_SIZE) break
    startPosition += PAGE_SIZE
    if (out.rows.length >= SAFETY_CAP) {
      out.errors.push(`Stopped at ${SAFETY_CAP} invoices — re-sync to continue`)
      out.capped = true
      break
    }
  }
  out.watermark = out.rows.reduce<string | null>((max, inv) => {
    const t = inv.MetaData?.LastUpdatedTime
    return t && (!max || t > max) ? t : max
  }, null)
  return out
}

/** Keep only rows newer than this facility's own cursor (a shared pull starts at the OLDEST cursor). */
function afterCursor<T extends { MetaData?: { LastUpdatedTime?: string } }>(rows: T[], cursor: string | null): T[] {
  if (!cursor) return rows
  const c = Date.parse(cursor)
  if (!Number.isFinite(c)) return rows
  return rows.filter((r) => {
    const t = r.MetaData?.LastUpdatedTime ? Date.parse(r.MetaData.LastUpdatedTime) : NaN
    return !Number.isFinite(t) || t > c
  })
}

export async function syncQBInvoices(
  facilityId: string,
  options: { fullSync?: boolean; createdBy?: string | null; prefetched?: PrefetchedInvoices } = {},
): Promise<SyncQBInvoicesResult> {
  const result: SyncQBInvoicesResult = { created: 0, updated: 0, skipped: 0, errors: [], cursorAdvanced: false, warnings: [] }
  // Per-row upsert failures: they mean the window was NOT fully ingested, so
  // the cursor must not move past it (see the guarded update at the end).
  let writeFailures = 0
  const { fullSync = false, createdBy = null } = options
  const startedAt = new Date()
  await ensureQbSafetySchema()

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { id: true, qbRealmId: true, qbInvoicesSyncCursor: true, qbInvoicesLastSyncedAt: true },
  })
  if (!facility?.qbRealmId) {
    throw new Error('QuickBooks not connected for this facility')
  }
  // Undo data (qb_sync_runs): pre-run cursor + every row's prior state.
  const prevCursor = facility.qbInvoicesSyncCursor ?? null
  const prevLastSyncedAt = facility.qbInvoicesLastSyncedAt?.toISOString() ?? null
  const insertedInvoiceIds: string[] = []
  const updatedPrev: Array<{ id: string; prevOpenBalanceCents: number; prevStatus: string; prevAmountCents: number }> = []

  const residentList = await db.query.residents.findMany({
    where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
    columns: { id: true, name: true, qbCustomerId: true },
  })
  const residentByQbId = new Map<string, string>()
  for (const r of residentList) {
    if (r.qbCustomerId) residentByQbId.set(r.qbCustomerId, r.id)
  }

  // Numeric Customer.Id → resident via qb_customer_links (Stage 1 customer
  // sync). Preferred over display-name/fuzzy matching — exact and rename-proof.
  await ensureQbLinksSchema()
  const residentByNumericId = new Map<string, string>()
  const linkedIds = new Set<string>()
  try {
    const links = await db.query.qbCustomerLinks.findMany({
      where: eq(qbCustomerLinks.facilityId, facilityId),
      columns: { residentId: true, qbCustomerId: true },
    })
    for (const l of links) {
      linkedIds.add(l.qbCustomerId)
      if (l.residentId) residentByNumericId.set(l.qbCustomerId, l.residentId)
    }
  } catch (err) {
    // Best-effort — matching falls back to display-name/fuzzy.
    console.error('[qb-invoice-sync] customer links load failed:', err)
  }
  // SHARED-REALM GUARD: skip invoices provably belonging to another facility
  // (foreign "FXXX:" customer prefix) — the realm can hold every facility's
  // customers, and ingesting them here would attribute other facilities'
  // money to this one. `null` verdicts sync normally.
  const scope = await getFacilityQbScope(facilityId)

  const existingInvoices = await db.query.qbInvoices.findMany({
    where: eq(qbInvoices.facilityId, facilityId),
    columns: { id: true, invoiceNum: true, openBalanceCents: true, status: true, qbInvoiceId: true, amountCents: true },
  })
  const existingByNum = new Map(existingInvoices.map((i) => [i.invoiceNum, i]))

  const cursor = fullSync ? null : (facility.qbInvoicesSyncCursor ?? null)

  // P48 — track WHY the pull ended. The cursor may only move forward over a
  // window we actually ingested; see the guarded update at the end. A realm
  // pull handed in by qb-realm-sync.ts is filtered to this facility's window.
  const pull = options.prefetched
    ? { ...options.prefetched, rows: afterCursor(options.prefetched.rows, cursor) }
    : await fetchQBInvoices(facilityId, cursor)
  result.errors.push(...pull.errors)
  const { fetchFailed, capped } = pull
  const allInvoices = pull.rows

  for (const inv of allInvoices) {
    const invoiceNum = inv.DocNumber ?? inv.Id
    if (!invoiceNum) {
      result.errors.push(`Invoice ${inv.Id} missing DocNumber and Id — skipped`)
      continue
    }
    if (inv.CustomerRef && customerBelongsToFacility(inv.CustomerRef, scope, linkedIds) === false) {
      result.skipped++
      continue // another facility's invoice
    }
    const amountCents = Math.round((inv.TotalAmt ?? 0) * 100)
    const openBalanceCents = Math.round((inv.Balance ?? 0) * 100)
    const status = deriveStatus(amountCents, openBalanceCents)
    const qbCustomerName = inv.CustomerRef?.name ?? ''

    let residentId: string | null = null
    if (inv.CustomerRef?.value) {
      residentId = residentByNumericId.get(inv.CustomerRef.value) ?? null
    }
    if (!residentId && qbCustomerName) {
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
      const [row] = await db
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
            // An invoice voided by a site-side undo stays 'void' (QB reports it
            // as a $0 paid invoice, which would otherwise relabel it).
            status: sql`CASE WHEN ${qbInvoices.status} = 'void' THEN 'void' ELSE excluded.status END`,
            qbInvoiceId: sql`excluded.qb_invoice_id`,
            syncedAt: sql`excluded.synced_at`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: qbInvoices.id })
      // `existingByNum` is keyed by invoice_num alone while the conflict target is
      // (num, facility, date) — QB nums recur across years — so classify by the
      // row the upsert actually touched, never by the lookup.
      if (existing && row?.id === existing.id) {
        result.updated++
        updatedPrev.push({
          id: existing.id,
          prevOpenBalanceCents: existing.openBalanceCents,
          prevStatus: existing.status,
          prevAmountCents: existing.amountCents,
        })
      } else {
        result.created++
        if (row?.id) insertedInvoiceIds.push(row.id)
      }
    } catch (err) {
      result.errors.push(`Invoice ${invoiceNum}: ${(err as Error).message?.slice(0, 200)}`)
      writeFailures++
    }
  }

  // SITE-PAID PROTECTION: QB is authoritative for what it knows, but it does not
  // know about money collected on the site (card/portal/salon credit). Clamp
  // every site-paid invoice back down BEFORE recomputing balances so the
  // autopay sweep can never re-charge a family for an invoice they already
  // paid here. See qb-site-payments.ts.
  const { ambiguous } = await reapplySitePayments(db, [facilityId])
  if (ambiguous.length > 0) {
    const sample = ambiguous.slice(0, 3).map((a) => `#${a.invoiceNum}`).join(', ')
    result.warnings.push(
      `${ambiguous.length} invoice(s) have payments recorded on BOTH the site and in QuickBooks (${sample}${ambiguous.length > 3 ? ', …' : ''}) — the site is showing the lower balance; confirm in QuickBooks`,
    )
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
      // The pull's watermark covers every fetched row (the whole realm in a
      // shared pull) — safe to advance to even when none were this facility's.
      nextCursor = pull.watermark // null → stay put rather than guess
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

  // Audit + undo record (best-effort; never fails the sync). Only worth a row
  // when something actually changed.
  if (result.created + result.updated > 0 || nextCursor) {
    await recordSyncRun({
      facilityId,
      action: 'sync_invoices',
      startedAt,
      createdBy,
      summary: {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors.slice(0, 5),
        warnings: result.warnings.slice(0, 5),
        cursorAdvanced: result.cursorAdvanced,
        fullSync,
      },
      items: { prevCursor, prevLastSyncedAt, insertedInvoiceIds, updated: updatedPrev },
    })
  }

  return result
}
