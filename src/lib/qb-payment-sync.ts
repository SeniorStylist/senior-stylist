// QuickBooks payment + credit PULL — live replacement for CSV import steps 3–5
// on connected facilities. Pulls Payment objects (and their unapplied amounts)
// plus CreditMemos into qb_payments / qb_unapplied_credits.
//
// Contracts carried over verbatim:
// - P48 cursorAdvanced: the cursor (qb_sync_state.payments_sync_cursor) only
//   moves over a window actually ingested; callers treat result.cursorAdvanced,
//   NOT errors.length, as the success signal.
// - qb_payments dedup is a MULTISET pool-and-pop (mirrors the CSV importer),
//   NEVER a unique constraint: a payment previously CSV-imported or
//   check-scanned gets its qb_payment_id stamped instead of double-counting,
//   and resident-level rows claim-and-upgrade facility-level ones.
// - qb_unapplied_credits is upsert-only here: open_balance updates never touch
//   applied_cents/applied_at/applied_detail (site-applied preservation). CSV
//   Step 5 remains the authoritative snapshot tool.

import { db } from '@/db'
import { qbPayments, qbUnappliedCredits, qbCustomerLinks, qbSyncState, residents, facilities } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { qbGet } from '@/lib/quickbooks'
import { fuzzyBestMatch } from '@/lib/fuzzy'
import { parseResidentName } from '@/lib/qb-invoice-sync'
import { ensureQbLinksSchema } from '@/lib/qb-links-ddl'
import { ensureUnappliedSchema } from '@/lib/unapplied-ddl'

interface QBPayment {
  Id: string
  TxnDate: string
  TotalAmt?: number
  UnappliedAmt?: number
  PaymentRefNum?: string
  PrivateNote?: string
  CustomerRef?: { value: string; name?: string }
  PaymentMethodRef?: { value: string; name?: string }
  MetaData?: { LastUpdatedTime: string }
}

interface QBCreditMemo {
  Id: string
  DocNumber?: string
  TxnDate: string
  TotalAmt?: number
  Balance?: number
  CustomerRef?: { value: string; name?: string }
  MetaData?: { LastUpdatedTime: string }
}

export interface SyncQBPaymentsResult {
  created: number
  upgraded: number
  skipped: number
  updated: number
  creditsUpserted: number
  errors: string[]
  cursorAdvanced: boolean
}

const PAGE_SIZE = 100
const SAFETY_CAP = 5000

function chunkArr<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function pullEntity<T>(
  facilityId: string,
  entity: 'Payment' | 'CreditMemo',
  cursor: string | null,
  errors: string[],
): Promise<{ rows: T[]; fetchFailed: boolean; capped: boolean }> {
  const whereClause = cursor
    ? ` WHERE Metadata.LastUpdatedTime > '${cursor.replace(/'/g, "\\'")}'`
    : ''
  const rows: T[] = []
  let startPosition = 1
  let fetchFailed = false
  let capped = false
  while (true) {
    const query = `SELECT * FROM ${entity}${whereClause} STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
    let res: { QueryResponse?: Record<string, unknown> }
    try {
      res = await qbGet(facilityId, `/query?query=${encodeURIComponent(query)}&minorversion=65`)
    } catch (err) {
      errors.push(`${entity} query failed at ${startPosition}: ${(err as Error).message?.slice(0, 200)}`)
      fetchFailed = true
      break
    }
    const page = ((res.QueryResponse?.[entity] as T[] | undefined) ?? [])
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    startPosition += PAGE_SIZE
    if (rows.length >= SAFETY_CAP) {
      errors.push(`Stopped at ${SAFETY_CAP} ${entity} rows — re-sync to continue`)
      capped = true
      break
    }
  }
  return { rows, fetchFailed, capped }
}

export async function syncQBPayments(
  facilityId: string,
  options: { fullSync?: boolean } = {},
): Promise<SyncQBPaymentsResult> {
  await ensureQbLinksSchema()
  await ensureUnappliedSchema()
  const { fullSync = false } = options
  const result: SyncQBPaymentsResult = {
    created: 0,
    upgraded: 0,
    skipped: 0,
    updated: 0,
    creditsUpserted: 0,
    errors: [],
    cursorAdvanced: false,
  }

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { id: true, qbRealmId: true },
  })
  if (!facility?.qbRealmId) throw new Error('QuickBooks not connected for this facility')

  const state = await db.query.qbSyncState.findFirst({
    where: eq(qbSyncState.facilityId, facilityId),
    columns: { paymentsSyncCursor: true },
  }).catch(() => null)
  const cursor = fullSync ? null : (state?.paymentsSyncCursor ?? null)

  // ── Resident resolution maps ──────────────────────────────────────────
  const residentList = await db.query.residents.findMany({
    where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
    columns: { id: true, name: true, qbCustomerId: true },
  })
  const byDisplayName = new Map<string, string>()
  for (const r of residentList) {
    if (r.qbCustomerId) byDisplayName.set(r.qbCustomerId.trim().toLowerCase(), r.id)
  }
  const byNumericId = new Map<string, string>()
  const links = await db.query.qbCustomerLinks.findMany({
    where: eq(qbCustomerLinks.facilityId, facilityId),
    columns: { residentId: true, qbCustomerId: true },
  })
  for (const l of links) {
    if (l.residentId) byNumericId.set(l.qbCustomerId, l.residentId)
  }

  const resolveResident = (ref: { value: string; name?: string } | undefined): string | null => {
    if (!ref) return null
    const numeric = byNumericId.get(ref.value)
    if (numeric) return numeric
    const name = ref.name ?? ''
    if (!name) return null
    const exact = byDisplayName.get(name.trim().toLowerCase())
    if (exact) return exact
    const parsed = parseResidentName(name)
    if (!parsed) return null
    return fuzzyBestMatch(residentList, parsed, 0.7)?.id ?? null
  }

  // ── Pull both entities (cursor shared — they advance together) ────────
  const payPull = await pullEntity<QBPayment>(facilityId, 'Payment', cursor, result.errors)
  const cmPull = await pullEntity<QBCreditMemo>(facilityId, 'CreditMemo', cursor, result.errors)
  const fetchFailed = payPull.fetchFailed || cmPull.fetchFailed
  const capped = payPull.capped || cmPull.capped
  let writeFailures = 0

  // ── Payments: multiset dedup against existing rows ────────────────────
  const existingRows = await db
    .select({
      id: qbPayments.id,
      residentId: qbPayments.residentId,
      paymentDate: qbPayments.paymentDate,
      amountCents: qbPayments.amountCents,
      memo: qbPayments.memo,
      qbPaymentId: qbPayments.qbPaymentId,
    })
    .from(qbPayments)
    .where(and(eq(qbPayments.facilityId, facilityId), eq(qbPayments.isDemo, false)))

  const byQbId = new Map(existingRows.filter((p) => p.qbPaymentId).map((p) => [p.qbPaymentId as string, p]))
  // Pool ONLY rows with no qb_payment_id — a row already tied to a different
  // QB payment is a different payment and must never be claimed.
  const pool = new Map<string, { id: string; memo: string | null }[]>()
  const keyOf = (res: string | null, date: string, amt: number) => `${res ?? ''}|${date}|${amt}`
  for (const p of existingRows) {
    if (p.qbPaymentId) continue
    const k = keyOf(p.residentId, p.paymentDate, p.amountCents)
    const list = pool.get(k) ?? []
    list.push({ id: p.id, memo: p.memo })
    pool.set(k, list)
  }
  const popFrom = (k: string) => {
    const list = pool.get(k)
    if (!list || list.length === 0) return null
    return list.pop()!
  }

  type PaymentUpdate = {
    id: string
    residentId: string | null
    qbCustomerId: string | null
    memo: string | null
    qbPaymentId: string
    amountCents: number | null
    paymentDate: string | null
  }
  const toInsert: Array<typeof qbPayments.$inferInsert> = []
  const toUpdate: PaymentUpdate[] = []

  for (const p of payPull.rows) {
    const amountCents = Math.round((p.TotalAmt ?? 0) * 100)
    if (amountCents <= 0) continue
    const residentId = resolveResident(p.CustomerRef)
    const memo = p.PrivateNote?.slice(0, 2000) ?? null
    const qbCustomerName = p.CustomerRef?.name ?? null

    const known = byQbId.get(p.Id)
    if (known) {
      // Already synced — refresh amount/date (a payment edited in QB) and
      // enrich memo; unchanged rows count as skipped.
      if (known.amountCents !== amountCents || known.paymentDate !== p.TxnDate || (memo && !known.memo)) {
        toUpdate.push({
          id: known.id,
          residentId: null,
          qbCustomerId: null,
          memo: memo && !known.memo ? memo : null,
          qbPaymentId: p.Id,
          amountCents,
          paymentDate: p.TxnDate,
        })
        result.updated++
      } else {
        result.skipped++
      }
      continue
    }

    const exact = popFrom(keyOf(residentId, p.TxnDate, amountCents))
    if (exact) {
      // Same money already recorded (CSV import / check scan) — stamp the QB id.
      toUpdate.push({
        id: exact.id,
        residentId: null,
        qbCustomerId: qbCustomerName,
        memo: memo && !exact.memo ? memo : null,
        qbPaymentId: p.Id,
        amountCents: null,
        paymentDate: null,
      })
      result.skipped++
      continue
    }
    if (residentId) {
      const facLevel = popFrom(keyOf(null, p.TxnDate, amountCents))
      if (facLevel) {
        toUpdate.push({
          id: facLevel.id,
          residentId,
          qbCustomerId: qbCustomerName,
          memo: memo && !facLevel.memo ? memo : null,
          qbPaymentId: p.Id,
          amountCents: null,
          paymentDate: null,
        })
        result.upgraded++
        continue
      }
    }

    toInsert.push({
      facilityId,
      residentId,
      qbCustomerId: qbCustomerName,
      paymentDate: p.TxnDate,
      amountCents,
      memo,
      checkNum: p.PaymentRefNum ?? null,
      paymentMethod: (p.PaymentMethodRef?.name ?? 'check').toLowerCase().slice(0, 50),
      recordedVia: 'qb_sync',
      qbPaymentId: p.Id,
      syncedAt: new Date(),
    })
  }

  // Batched UPDATE … FROM (VALUES …) — never per-row loops (max:1 pool).
  try {
    for (const ch of chunkArr(toUpdate, 200)) {
      const valueRows = ch.map((u) => sql`(
        ${u.id}::uuid,
        ${u.residentId}::uuid,
        ${u.qbCustomerId}::text,
        ${u.memo}::text,
        ${u.qbPaymentId}::text,
        ${u.amountCents}::integer,
        ${u.paymentDate}::date
      )`)
      await db.execute(sql`
        UPDATE qb_payments p SET
          resident_id = COALESCE(v.resident_id, p.resident_id),
          qb_customer_id = COALESCE(v.qb_customer_id, p.qb_customer_id),
          memo = COALESCE(p.memo, v.memo),
          qb_payment_id = COALESCE(v.qb_payment_id, p.qb_payment_id),
          amount_cents = COALESCE(v.amount_cents, p.amount_cents),
          payment_date = COALESCE(v.payment_date, p.payment_date),
          synced_at = now()
        FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, resident_id, qb_customer_id, memo, qb_payment_id, amount_cents, payment_date)
        WHERE p.id = v.id
      `)
    }
    for (const ch of chunkArr(toInsert, 100)) {
      await db.insert(qbPayments).values(ch)
      result.created += ch.length
    }
  } catch (err) {
    result.errors.push(`Payment writes failed: ${(err as Error).message?.slice(0, 200)}`)
    writeFailures++
  }

  // ── Credits: upsert-only (never touches applied_* / never deletes) ────
  type CreditRow = {
    qbCustomerId: string
    residentId: string | null
    txnType: string
    txnDate: string
    num: string | null
    amountCents: number
    openBalanceCents: number
  }
  const credits: CreditRow[] = []
  for (const p of payPull.rows) {
    const unapplied = Math.round((p.UnappliedAmt ?? 0) * 100)
    const total = Math.round((p.TotalAmt ?? 0) * 100)
    if (total <= 0) continue
    const name = p.CustomerRef?.name
    if (!name) continue
    // Include zero-unapplied rows so a previously-banked credit zeroes out
    // when QB applies it (upsert refreshes open_balance; never inserts a 0 row).
    credits.push({
      qbCustomerId: name,
      residentId: resolveResident(p.CustomerRef),
      txnType: 'Payment',
      txnDate: p.TxnDate,
      num: p.PaymentRefNum ?? null,
      amountCents: total,
      openBalanceCents: unapplied,
    })
  }
  for (const cm of cmPull.rows) {
    const balance = Math.round((cm.Balance ?? 0) * 100)
    const total = Math.round((cm.TotalAmt ?? 0) * 100)
    const name = cm.CustomerRef?.name
    if (!name || total <= 0) continue
    credits.push({
      qbCustomerId: name,
      residentId: resolveResident(cm.CustomerRef),
      txnType: 'Credit Memo',
      txnDate: cm.TxnDate,
      num: cm.DocNumber ?? cm.Id,
      amountCents: total,
      openBalanceCents: balance,
    })
  }

  if (credits.length > 0) {
    try {
      const existingCredits = await db.query.qbUnappliedCredits.findMany({
        where: eq(qbUnappliedCredits.facilityId, facilityId),
        columns: { id: true, qbCustomerId: true, txnType: true, txnDate: true, num: true, openBalanceCents: true },
      })
      const creditKey = (c: { qbCustomerId: string; txnType: string; txnDate: string; num: string | null }) =>
        `${c.qbCustomerId.trim().toLowerCase()}|${c.txnType}|${c.txnDate}|${c.num ?? ''}`
      const existingByKey = new Map(existingCredits.map((c) => [creditKey(c), c]))

      const creditUpdates: Array<{ id: string; openBalanceCents: number }> = []
      const creditInserts: Array<typeof qbUnappliedCredits.$inferInsert> = []
      for (const c of credits) {
        const existing = existingByKey.get(creditKey(c))
        if (existing) {
          if (existing.openBalanceCents !== c.openBalanceCents) {
            creditUpdates.push({ id: existing.id, openBalanceCents: c.openBalanceCents })
            result.creditsUpserted++
          }
        } else if (c.openBalanceCents > 0) {
          creditInserts.push({
            facilityId,
            residentId: c.residentId,
            qbCustomerId: c.qbCustomerId,
            txnType: c.txnType,
            txnDate: c.txnDate,
            num: c.num,
            amountCents: c.amountCents,
            openBalanceCents: c.openBalanceCents,
          })
          result.creditsUpserted++
        }
      }
      for (const ch of chunkArr(creditUpdates, 200)) {
        const valueRows = ch.map((u) => sql`(${u.id}::uuid, ${u.openBalanceCents}::integer)`)
        await db.execute(sql`
          UPDATE qb_unapplied_credits c SET open_balance_cents = v.open_balance_cents
          FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(id, open_balance_cents)
          WHERE c.id = v.id
        `)
      }
      for (const ch of chunkArr(creditInserts, 100)) {
        await db.insert(qbUnappliedCredits).values(ch)
      }
    } catch (err) {
      result.errors.push(`Credit writes failed: ${(err as Error).message?.slice(0, 200)}`)
      writeFailures++
    }
  }

  // ── Cursor (P48 contract — only over an ingested window) ─────────────
  let nextCursor: string | null = null
  if (!fetchFailed && writeFailures === 0) {
    if (capped) {
      const newest = [...payPull.rows, ...cmPull.rows].reduce<string | null>((max, row) => {
        const t = (row as { MetaData?: { LastUpdatedTime?: string } }).MetaData?.LastUpdatedTime
        return t && (!max || t > max) ? t : max
      }, null)
      nextCursor = newest // null → stay put rather than guess
    } else {
      nextCursor = new Date().toISOString()
    }
  }

  if (nextCursor) {
    await db.execute(sql`
      INSERT INTO qb_sync_state (facility_id, payments_sync_cursor, payments_last_synced_at, updated_at)
      VALUES (${facilityId}, ${nextCursor}, now(), now())
      ON CONFLICT (facility_id) DO UPDATE SET
        payments_sync_cursor = excluded.payments_sync_cursor,
        payments_last_synced_at = excluded.payments_last_synced_at,
        updated_at = excluded.updated_at
    `)
  }
  result.cursorAdvanced = !!nextCursor

  return result
}
