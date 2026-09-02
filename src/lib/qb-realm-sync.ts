// Realm-level nightly sync — ONE QuickBooks pull per company, applied to every
// attached facility.
//
// Production QuickBooks is a single company holding every facility, so the
// per-facility engines (qb-invoice-sync.ts / qb-payment-sync.ts) each pull the
// WHOLE realm's changes and keep only their own rows. Run per facility across
// 100+ facilities that is 100+ identical pulls a night against one 500/min
// realm budget. This orchestrator pulls once from the OLDEST attached cursor,
// routes every row to its facility, and hands each facility only its rows —
// the per-facility engines then apply them with their existing contracts
// (P48 cursorAdvanced, multiset dedup, site-paid clamp, undo runs) untouched.
//
// Routing: numeric CustomerRef → qb_customer_links (any attached facility);
// otherwise the "FXXX:" name prefix / top-level F-code → facility code. Rows
// that route to no facility are counted as `unrouted` — they are applied only
// when the realm has exactly ONE attached facility (the historic
// single-company behavior, where plain customer names are normal).

import { db } from '@/db'
import { facilities, qbCustomerLinks, qbSyncState } from '@/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { fetchQBInvoices, syncQBInvoices, type PrefetchedInvoices, type SyncQBInvoicesResult } from '@/lib/qb-invoice-sync'
import {
  fetchQBPaymentsAndCredits,
  syncQBPayments,
  type PrefetchedPayments,
  type SyncQBPaymentsResult,
} from '@/lib/qb-payment-sync'
import { ensureQbLinksSchema } from '@/lib/qb-links-ddl'
import { processPaymentMirrorQueue } from '@/lib/qb-payment-mirror'

export interface RealmFacilityOutcome {
  facilityId: string
  name: string
  mirrored: number
  invoices: SyncQBInvoicesResult | null
  payments: SyncQBPaymentsResult | null
  error: string | null
}

export interface RealmSyncResult {
  realmId: string
  facilities: RealmFacilityOutcome[]
  unroutedInvoices: number
  unroutedPayments: number
  unroutedCredits: number
}

type Ref = { value: string; name?: string } | undefined
const F_CODE_RE = /^f\d{2,5}$/

/** Build a CustomerRef → facilityId router for every facility attached to the realm. */
async function buildRouter(facilityIds: string[]) {
  await ensureQbLinksSchema()
  const [facs, links] = await Promise.all([
    db.query.facilities.findMany({
      where: inArray(facilities.id, facilityIds),
      columns: { id: true, facilityCode: true },
    }),
    db.query.qbCustomerLinks.findMany({
      where: inArray(qbCustomerLinks.facilityId, facilityIds),
      columns: { facilityId: true, qbCustomerId: true },
    }),
  ])
  const byCustomerId = new Map(links.map((l) => [l.qbCustomerId, l.facilityId]))
  const byCode = new Map<string, string>()
  for (const f of facs) {
    if (f.facilityCode) byCode.set(f.facilityCode.trim().toLowerCase(), f.id)
  }
  const sole = facilityIds.length === 1 ? facilityIds[0] : null

  return (ref: Ref): string | null => {
    if (!ref) return sole
    if (ref.value && byCustomerId.has(ref.value)) return byCustomerId.get(ref.value)!
    const name = (ref.name ?? '').trim().toLowerCase()
    if (name) {
      const colon = name.indexOf(':')
      const head = (colon > 0 ? name.slice(0, colon) : name.split(/\s/)[0] ?? '').trim()
      if (byCode.has(head)) return byCode.get(head)!
      if (F_CODE_RE.test(head)) return null // another company's F-code — never ours
    }
    return sole
  }
}

function groupBy<T>(rows: T[], keyOf: (r: T) => string | null): { groups: Map<string, T[]>; unrouted: number } {
  const groups = new Map<string, T[]>()
  let unrouted = 0
  for (const r of rows) {
    const k = keyOf(r)
    if (!k) {
      unrouted++
      continue
    }
    const list = groups.get(k) ?? []
    list.push(r)
    groups.set(k, list)
  }
  return { groups, unrouted }
}

/**
 * Sync every given facility of one realm with a single pull per entity.
 * `facilityIds` must all be attached to `realmId` (the caller selects them,
 * applying the cron's cooldown/limit rules). Never throws for one facility's
 * failure — outcomes are per facility.
 */
export async function syncRealm(
  realmId: string,
  facilityIds: string[],
  opts: { createdBy?: string | null; mirrorLimit?: number } = {},
): Promise<RealmSyncResult> {
  const result: RealmSyncResult = {
    realmId,
    facilities: [],
    unroutedInvoices: 0,
    unroutedPayments: 0,
    unroutedCredits: 0,
  }
  if (facilityIds.length === 0) return result

  const facs = await db.query.facilities.findMany({
    where: and(inArray(facilities.id, facilityIds), eq(facilities.qbRealmId, realmId)),
    columns: { id: true, name: true, qbInvoicesSyncCursor: true },
  })
  if (facs.length === 0) return result
  const ids = facs.map((f) => f.id)
  const outcomes = new Map<string, RealmFacilityOutcome>(
    facs.map((f) => [f.id, { facilityId: f.id, name: f.name, mirrored: 0, invoices: null, payments: null, error: null }]),
  )

  // (0) Finish site→QB payment mirrors BEFORE pulling, so the pull sees
  //     balances that already include the site's money.
  for (const f of facs) {
    try {
      const m = await processPaymentMirrorQueue(f.id, opts.mirrorLimit ?? 25)
      outcomes.get(f.id)!.mirrored = m.done
    } catch (err) {
      console.error(`[qb-realm-sync] mirror queue for ${f.id} threw:`, err)
    }
  }

  const route = await buildRouter(ids)
  // Any attached facility's id works for the token — it is the realm's.
  const tokenFacility = ids[0]

  // (1) Invoices — one pull from the OLDEST cursor (null = full window).
  const invoiceCursor = facs.some((f) => !f.qbInvoicesSyncCursor)
    ? null
    : facs.map((f) => f.qbInvoicesSyncCursor as string).sort()[0]
  const invPull = await fetchQBInvoices(tokenFacility, invoiceCursor)
  const invRouted = groupBy(invPull.rows, (inv) => route(inv.CustomerRef))
  result.unroutedInvoices = invRouted.unrouted
  for (const f of facs) {
    const pre: PrefetchedInvoices = { ...invPull, rows: invRouted.groups.get(f.id) ?? [] }
    try {
      outcomes.get(f.id)!.invoices = await syncQBInvoices(f.id, { createdBy: opts.createdBy ?? null, prefetched: pre })
    } catch (err) {
      outcomes.get(f.id)!.error = (err as Error).message?.slice(0, 300) ?? 'invoice sync threw'
    }
  }

  // (2) Payments + credit memos — one pull from the OLDEST payments cursor.
  const states = await db.query.qbSyncState.findMany({
    where: inArray(qbSyncState.facilityId, ids),
    columns: { facilityId: true, paymentsSyncCursor: true },
  })
  const payCursors = ids.map((id) => states.find((s) => s.facilityId === id)?.paymentsSyncCursor ?? null)
  const payCursor = payCursors.some((c) => !c) ? null : (payCursors as string[]).sort()[0]
  const payPull = await fetchQBPaymentsAndCredits(tokenFacility, payCursor)
  const payRouted = groupBy(payPull.pay.rows, (p) => route(p.CustomerRef))
  const cmRouted = groupBy(payPull.cm.rows, (c) => route(c.CustomerRef))
  result.unroutedPayments = payRouted.unrouted
  result.unroutedCredits = cmRouted.unrouted
  for (const f of facs) {
    const out = outcomes.get(f.id)!
    // Payment pull only after a successful invoice window (same rule as the cron).
    if (!out.invoices?.cursorAdvanced) continue
    const pre: PrefetchedPayments = {
      pay: { ...payPull.pay, rows: payRouted.groups.get(f.id) ?? [] },
      cm: { ...payPull.cm, rows: cmRouted.groups.get(f.id) ?? [] },
      errors: payPull.errors,
    }
    try {
      out.payments = await syncQBPayments(f.id, { createdBy: opts.createdBy ?? null, prefetched: pre })
    } catch (err) {
      out.error = (err as Error).message?.slice(0, 300) ?? 'payment sync threw'
    }
  }

  result.facilities = ids.map((id) => outcomes.get(id)!)
  return result
}

/** Attached, active, non-demo facilities grouped by realm (for the cron). */
export async function facilitiesByRealm(excludeIds: string[] = []): Promise<Map<string, Array<{ id: string; name: string }>>> {
  const rows = (await db.execute(sql`
    SELECT f.id::text AS id, f.name, f.qb_realm_id AS realm_id
    FROM facilities f
    JOIN qb_connections c ON c.realm_id = f.qb_realm_id
    WHERE f.active = true AND f.is_demo = false
      AND c.refresh_token IS NOT NULL AND c.revoked_at IS NULL
    ORDER BY f.qb_invoices_last_synced_at ASC NULLS FIRST
  `)) as unknown as Array<{ id: string; name: string; realm_id: string }>
  const skip = new Set(excludeIds)
  const map = new Map<string, Array<{ id: string; name: string }>>()
  for (const r of rows) {
    if (skip.has(r.id)) continue
    const list = map.get(r.realm_id) ?? []
    list.push({ id: r.id, name: r.name })
    map.set(r.realm_id, list)
  }
  return map
}
