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
import { qbGet, qbQuoteLiteral } from '@/lib/quickbooks'
import { fuzzyBestMatch } from '@/lib/fuzzy'
import { parseResidentName } from '@/lib/qb-invoice-sync'
import { ensureQbLinksSchema } from '@/lib/qb-links-ddl'
import { ensureUnappliedSchema } from '@/lib/unapplied-ddl'
import { customerBelongsToFacility, getFacilityQbScope } from '@/lib/qb-scope'
import {
  capLabels,
  recordSyncRun,
  type CreditLabel,
  type PaymentLabel,
  type SyncPaymentsRunItems,
} from '@/lib/qb-runs'
import { chunkArr } from '@/lib/imports/qb-csv'
import { loadMirrorRefs } from '@/lib/qb-payment-mirror'

export interface QBPayment {
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

export interface QBCreditMemo {
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
  /** qb_sync_runs id — undo handle. */
  runId: string | null
}

const PAGE_SIZE = 100
const SAFETY_CAP = 5000

export interface EntityPull<T> {
  rows: T[]
  fetchFailed: boolean
  capped: boolean
  /** Newest LastUpdatedTime across EVERY fetched row (pre-routing) — a capped
   *  pull's true coverage, valid even for a facility that owned none of them. */
  watermark: string | null
}

/** A realm-wide payment + credit-memo pull several facilities can apply (qb-realm-sync.ts). */
export interface PrefetchedPayments {
  pay: EntityPull<QBPayment>
  cm: EntityPull<QBCreditMemo>
  errors: string[]
}

export async function fetchQBPaymentsAndCredits(
  facilityId: string,
  cursor: string | null,
): Promise<PrefetchedPayments> {
  const errors: string[] = []
  const pay = await pullEntity<QBPayment>(facilityId, 'Payment', cursor, errors)
  const cm = await pullEntity<QBCreditMemo>(facilityId, 'CreditMemo', cursor, errors)
  return { pay, cm, errors }
}

/** Keep only rows newer than this facility's own cursor (a shared pull starts at the OLDEST cursor). */
function afterCursor<T extends { MetaData?: { LastUpdatedTime?: string } }>(pull: EntityPull<T>, cursor: string | null): EntityPull<T> {
  if (!cursor) return pull
  const c = Date.parse(cursor)
  if (!Number.isFinite(c)) return pull
  return {
    ...pull,
    rows: pull.rows.filter((r) => {
      const t = r.MetaData?.LastUpdatedTime ? Date.parse(r.MetaData.LastUpdatedTime) : NaN
      return !Number.isFinite(t) || t > c
    }),
  }
}

async function pullEntity<T>(
  facilityId: string,
  entity: 'Payment' | 'CreditMemo',
  cursor: string | null,
  errors: string[],
): Promise<EntityPull<T>> {
  const whereClause = cursor
    ? ` WHERE Metadata.LastUpdatedTime > ${qbQuoteLiteral(cursor)}`
    : ''
  const rows: T[] = []
  let startPosition = 1
  let fetchFailed = false
  let capped = false
  while (true) {
    // ORDERBY LastUpdatedTime so a capped pull's newest row is a true watermark.
    const query = `SELECT * FROM ${entity}${whereClause} ORDERBY Metadata.LastUpdatedTime ASC STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`
    let res: { QueryResponse?: Record<string, unknown> }
    try {
      res = await qbGet(facilityId, `/query?query=${encodeURIComponent(query)}`)
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
  const watermark = (rows as Array<{ MetaData?: { LastUpdatedTime?: string } }>).reduce<string | null>((max, row) => {
    const t = row.MetaData?.LastUpdatedTime
    return t && (!max || t > max) ? t : max
  }, null)
  return { rows, fetchFailed, capped, watermark }
}

export async function syncQBPayments(
  facilityId: string,
  options: { fullSync?: boolean; createdBy?: string | null; prefetched?: PrefetchedPayments } = {},
): Promise<SyncQBPaymentsResult> {
  await ensureQbLinksSchema()
  await ensureUnappliedSchema()
  const { fullSync = false, createdBy = null } = options
  const startedAt = new Date()
  const result: SyncQBPaymentsResult = {
    created: 0,
    upgraded: 0,
    skipped: 0,
    updated: 0,
    creditsUpserted: 0,
    errors: [],
    cursorAdvanced: false,
    runId: null,
  }
  // Undo data (qb_sync_runs)
  const undo: SyncPaymentsRunItems = {
    prevCursor: null,
    prevLastSyncedAt: null,
    insertedPaymentIds: [],
    stamped: [],
    upgraded: [],
    refreshed: [],
    insertedCreditIds: [],
    updatedCredits: [],
  }

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { id: true, qbRealmId: true },
  })
  if (!facility?.qbRealmId) throw new Error('QuickBooks not connected for this facility')

  const state = await db.query.qbSyncState.findFirst({
    where: eq(qbSyncState.facilityId, facilityId),
    columns: { paymentsSyncCursor: true, paymentsLastSyncedAt: true },
  }).catch(() => null)
  const cursor = fullSync ? null : (state?.paymentsSyncCursor ?? null)
  undo.prevCursor = state?.paymentsSyncCursor ?? null
  undo.prevLastSyncedAt = state?.paymentsLastSyncedAt?.toISOString() ?? null

  // ── Resident resolution maps ──────────────────────────────────────────
  const residentList = await db.query.residents.findMany({
    where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
    columns: { id: true, name: true, roomNumber: true, qbCustomerId: true },
  })
  const byDisplayName = new Map<string, string>()
  const residentById = new Map<string, { name: string; roomNumber: string | null }>()
  for (const r of residentList) {
    if (r.qbCustomerId) byDisplayName.set(r.qbCustomerId.trim().toLowerCase(), r.id)
    residentById.set(r.id, { name: r.name, roomNumber: r.roomNumber })
  }

  const insertedPaymentLabels: PaymentLabel[] = []
  const insertedCreditLabels: CreditLabel[] = []

  const creditLabel = (c: {
    txnType: string | null
    num: string | null
    txnDate: string | null
    amountCents: number
    openBalanceCents: number
    residentId: string | null
  }): CreditLabel => ({
    txnType: c.txnType,
    num: c.num,
    txnDate: c.txnDate,
    amountCents: c.amountCents,
    openBalanceCents: c.openBalanceCents,
    residentName: c.residentId ? (residentById.get(c.residentId)?.name ?? null) : null,
  })

  /** A payment as a bookkeeper reads it. Snapshotted at record time because
   *  undo DELETES inserted rows and nulls upgraded ones — no later join can
   *  bring these back. */
  const paymentLabel = (
    checkNum: string | null,
    paymentDate: string | null,
    amountCents: number,
    residentId: string | null,
  ): PaymentLabel => {
    const r = residentId ? residentById.get(residentId) : undefined
    return {
      checkNum,
      paymentDate,
      amountCents,
      residentName: r?.name ?? null,
      roomNumber: r?.roomNumber ?? null,
    }
  }
  const byNumericId = new Map<string, string>()
  const linkedIds = new Set<string>()
  const links = await db.query.qbCustomerLinks.findMany({
    where: eq(qbCustomerLinks.facilityId, facilityId),
    columns: { residentId: true, qbCustomerId: true },
  })
  for (const l of links) {
    linkedIds.add(l.qbCustomerId)
    if (l.residentId) byNumericId.set(l.qbCustomerId, l.residentId)
  }

  // SHARED-REALM GUARD: the realm can hold every facility's customers.
  // Rows provably belonging to another facility (foreign "FXXX:" prefix /
  // foreign parent) are skipped entirely — never ingested under this
  // facility. `null` verdicts (plain names, single-facility realms) keep
  // the historic behavior and sync normally.
  const scope = await getFacilityQbScope(facilityId)
  const isForeign = (ref: { value: string; name?: string } | undefined): boolean =>
    customerBelongsToFacility(ref, scope, linkedIds) === false

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
  // A realm pull handed in by qb-realm-sync.ts is filtered to this facility's window.
  const pre = options.prefetched
  const payPull = pre ? afterCursor(pre.pay, cursor) : await pullEntity<QBPayment>(facilityId, 'Payment', cursor, result.errors)
  const cmPull = pre ? afterCursor(pre.cm, cursor) : await pullEntity<QBCreditMemo>(facilityId, 'CreditMemo', cursor, result.errors)
  if (pre) result.errors.push(...pre.errors)
  const fetchFailed = payPull.fetchFailed || cmPull.fetchFailed
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
      // Same query, two more columns — they let the history name the money
      // ("check #4471, Aug 14, $48.00") instead of counting anonymous rows.
      checkNum: qbPayments.checkNum,
    })
    .from(qbPayments)
    .where(and(eq(qbPayments.facilityId, facilityId), eq(qbPayments.isDemo, false)))

  const byQbId = new Map(existingRows.filter((p) => p.qbPaymentId).map((p) => [p.qbPaymentId as string, p]))
  const rowById = new Map(existingRows.map((p) => [p.id, p]))
  // Site-originated payments the mirror wrote INTO QuickBooks (PaymentRefNum
  // = queue ref). If the mirror created the QB payment but didn't finalize
  // locally (crash), the pull must STAMP the site row, never insert a twin.
  const mirrorRefs = await loadMirrorRefs(facilityId).catch(() => new Map<string, { paymentId: string; status: string }>())
  // Pool ONLY rows with no qb_payment_id — a row already tied to a different
  // QB payment is a different payment and must never be claimed.
  type PoolRow = {
    id: string
    memo: string | null
    checkNum: string | null
    paymentDate: string
    amountCents: number
    residentId: string | null
  }
  const pool = new Map<string, PoolRow[]>()
  const keyOf = (res: string | null, date: string, amt: number) => `${res ?? ''}|${date}|${amt}`
  for (const p of existingRows) {
    if (p.qbPaymentId) continue
    const k = keyOf(p.residentId, p.paymentDate, p.amountCents)
    const list = pool.get(k) ?? []
    list.push({
      id: p.id,
      memo: p.memo,
      checkNum: p.checkNum,
      paymentDate: p.paymentDate,
      amountCents: p.amountCents,
      residentId: p.residentId,
    })
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
    if (isForeign(p.CustomerRef)) continue // another facility's payment
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
        undo.refreshed.push({
          id: known.id,
          prevAmountCents: known.amountCents,
          prevPaymentDate: known.paymentDate,
          memoWasNull: !known.memo,
          label: paymentLabel(known.checkNum ?? null, known.paymentDate, known.amountCents, residentId),
          newAmountCents: amountCents,
          newPaymentDate: p.TxnDate,
        })
        result.updated++
      } else {
        result.skipped++
      }
      continue
    }

    const mirror = p.PaymentRefNum ? mirrorRefs.get(p.PaymentRefNum) : undefined
    if (mirror) {
      const siteRow = rowById.get(mirror.paymentId)
      if (siteRow && !siteRow.qbPaymentId) {
        toUpdate.push({
          id: siteRow.id,
          residentId: null,
          qbCustomerId: null,
          memo: null,
          qbPaymentId: p.Id,
          amountCents: null,
          paymentDate: null,
        })
        undo.stamped.push({
          id: siteRow.id,
          memoWasNull: !siteRow.memo,
          label: paymentLabel(
            siteRow.checkNum ?? null,
            siteRow.paymentDate,
            siteRow.amountCents,
            siteRow.residentId ?? residentId,
          ),
        })
      }
      result.skipped++
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
      undo.stamped.push({
        id: exact.id,
        memoWasNull: !exact.memo,
        label: paymentLabel(exact.checkNum ?? null, exact.paymentDate, exact.amountCents, residentId),
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
        // The upgrade IS the change — money moving from "the facility paid" to
        // "Margaret Smith paid". Undo nulls the column, so the name has to be
        // snapshotted here or it can never be shown again.
        undo.upgraded.push({
          id: facLevel.id,
          memoWasNull: !facLevel.memo,
          label: paymentLabel(
            facLevel.checkNum ?? null,
            facLevel.paymentDate,
            facLevel.amountCents,
            residentId,
          ),
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
      const rows = await db.insert(qbPayments).values(ch).returning({ id: qbPayments.id })
      // id array stays a plain string[] — undo chunks it and counts its length.
      undo.insertedPaymentIds.push(...rows.map((r) => r.id))
      // Separate display array: undo deletes these rows, so this is the only
      // record of what the money was once it is reversed.
      insertedPaymentLabels.push(
        ...ch.map((c) =>
          paymentLabel(c.checkNum ?? null, c.paymentDate ?? null, c.amountCents ?? 0, c.residentId ?? null),
        ),
      )
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
    if (isForeign(p.CustomerRef)) continue
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
    if (isForeign(cm.CustomerRef)) continue
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
            undo.updatedCredits.push({
              id: existing.id,
              prevOpenBalanceCents: existing.openBalanceCents,
              label: creditLabel(c),
            })
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
        const rows = await db.insert(qbUnappliedCredits).values(ch).returning({ id: qbUnappliedCredits.id })
        undo.insertedCreditIds.push(...rows.map((r) => r.id))
        insertedCreditLabels.push(
          ...ch.map((c) =>
            creditLabel({
              txnType: c.txnType ?? null,
              num: c.num ?? null,
              txnDate: c.txnDate ?? null,
              amountCents: c.amountCents ?? 0,
              openBalanceCents: c.openBalanceCents ?? 0,
              residentId: c.residentId ?? null,
            }),
          ),
        )
      }
    } catch (err) {
      result.errors.push(`Credit writes failed: ${(err as Error).message?.slice(0, 200)}`)
      writeFailures++
    }
  }

  // ── Cursor (P48 contract — only over an ingested window) ─────────────
  // ONE cursor covers BOTH entities, so it may only advance to the SMALLER of
  // the two coverages: a fully-pulled entity covers "now", a capped one covers
  // only its newest ingested LastUpdatedTime. Taking the combined max would
  // let a small complete CreditMemo pull drag the cursor past thousands of
  // unfetched payments.
  const coverageOf = (pull: { capped: boolean; watermark: string | null }): string | null => {
    if (!pull.capped) return new Date().toISOString()
    // The pull's watermark covers every fetched row (the whole realm in a
    // shared pull); null → stay put rather than guess.
    return pull.watermark
  }
  let nextCursor: string | null = null
  if (!fetchFailed && writeFailures === 0) {
    const payCoverage = coverageOf(payPull)
    const cmCoverage = coverageOf(cmPull)
    nextCursor =
      payCoverage && cmCoverage
        ? (payCoverage < cmCoverage ? payCoverage : cmCoverage)
        : null
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

  // Audit + undo record (best-effort; never fails the sync).
  const touched =
    undo.insertedPaymentIds.length + undo.stamped.length + undo.upgraded.length +
    undo.refreshed.length + undo.insertedCreditIds.length + undo.updatedCredits.length
  const paymentLabelsCapped = capLabels(insertedPaymentLabels)
  const creditLabelsCapped = capLabels(insertedCreditLabels)
  if (touched > 0 || nextCursor) {
    result.runId = await recordSyncRun({
      facilityId,
      action: 'sync_payments',
      startedAt,
      createdBy,
      summary: {
        created: result.created,
        upgraded: result.upgraded,
        updated: result.updated,
        skipped: result.skipped,
        creditsUpserted: result.creditsUpserted,
        errors: result.errors.slice(0, 5),
        cursorAdvanced: result.cursorAdvanced,
        fullSync,
        capped: payPull.capped || cmPull.capped,
        fetchFailed,
      },
      items: {
        ...undo,
        ...(paymentLabelsCapped.rows.length ? { insertedPayments: paymentLabelsCapped.rows } : {}),
        ...(paymentLabelsCapped.truncated
          ? { insertedPaymentsTruncated: paymentLabelsCapped.truncated }
          : {}),
        ...(creditLabelsCapped.rows.length ? { insertedCredits: creditLabelsCapped.rows } : {}),
        ...(creditLabelsCapped.truncated
          ? { insertedCreditsTruncated: creditLabelsCapped.truncated }
          : {}),
      },
    })
  }

  return result
}
