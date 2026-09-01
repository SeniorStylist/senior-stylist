// QuickBooks invoice PUSH — "Send via QB". Creates real QB Invoices from the
// site's completed, UNPAID bookings for a month, one per resident (IP mode) or
// one facility-level invoice (RFMS mode), then optionally has QuickBooks email
// them. The pushed invoice is written back into qb_invoices under the existing
// (invoice_num, facility_id, invoice_date) dedup key so the nightly pull sees
// it as already-known, and the source bookings get qb_invoice_match_id set so
// a re-push can never double-bill them.

import { db } from '@/db'
import { bookings, facilities, paymentMethods, qbInvoices, qbSyncState, residents } from '@/db/schema'
import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { qbGet, qbPost, qbPostSend } from '@/lib/quickbooks'
import { recordSyncRun, type PushInvoiceRunItems } from '@/lib/qb-runs'
import { ensureQbSafetySchema } from '@/lib/qb-safety-ddl'
import {
  ensureQBCustomerForResident,
  ensureQBFacilityParent,
} from '@/lib/qb-customer-sync'
import { ensureQbLinksSchema } from '@/lib/qb-links-ddl'
import { dayRangeInTimezone, getLocalParts } from '@/lib/time'

interface QBInvoiceEntity {
  Id: string
  SyncToken: string
  DocNumber?: string
  TxnDate?: string
  TotalAmt?: number
}

export interface PushedInvoice {
  residentId: string | null
  residentName: string | null
  qbInvoiceId: string
  docNumber: string | null
  bookings: number
  amountCents: number
  emailed: boolean
  error?: string
}

export interface PushQBInvoicesResult {
  invoices: PushedInvoice[]
  totalCents: number
  skippedNoEmail: number
  /** Residents skipped because they are card-on-file autopay (collected on the site, not invoiced). */
  skippedAutopay: number
  nothingToBill: boolean
  errors: string[]
  /** qb_sync_runs id — undo handle. */
  runId: string | null
}

const INVOICE_CAP_PER_RUN = 50

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** [start, end) UTC window for a YYYY-MM month in the facility's timezone. */
function monthRangeInTimezone(
  month: string,
  timezone: string,
): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const startRange = dayRangeInTimezone(`${m[1]}-${m[2]}-01`, timezone)
  const nextY = mo === 12 ? y + 1 : y
  const nextMo = mo === 12 ? 1 : mo + 1
  const endRange = dayRangeInTimezone(`${nextY}-${pad(nextMo)}-01`, timezone)
  if (!startRange || !endRange) return null
  return { start: startRange.start, end: endRange.start }
}

/** QB Item to bill service lines against, provisioned once and cached in qb_sync_state. */
async function ensureQBServiceItem(facilityId: string): Promise<string> {
  const state = await db.query.qbSyncState.findFirst({
    where: eq(qbSyncState.facilityId, facilityId),
    columns: { qbServiceItemId: true },
  })
  if (state?.qbServiceItemId) return state.qbServiceItemId

  interface QBItem { Id: string; Name?: string }
  let itemId: string | null = null
  const findQuery = encodeURIComponent(
    "SELECT * FROM Item WHERE Name = 'Salon Services' MAXRESULTS 1",
  )
  const found = await qbGet<{ QueryResponse: { Item?: QBItem[] } }>(
    facilityId,
    `/query?query=${findQuery}&minorversion=65`,
  )
  itemId = found.QueryResponse?.Item?.[0]?.Id ?? null

  if (!itemId) {
    interface QBAccount { Id: string; Name?: string }
    const acctQuery = encodeURIComponent(
      "SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 10",
    )
    const accounts = await qbGet<{ QueryResponse: { Account?: QBAccount[] } }>(
      facilityId,
      `/query?query=${acctQuery}&minorversion=65`,
    )
    const list = accounts.QueryResponse?.Account ?? []
    const income =
      list.find((a) => /service|sales/i.test(a.Name ?? '')) ?? list[0]
    if (!income) {
      throw new Error('No Income account found in QuickBooks — create one first')
    }
    const created = await qbPost<{ Item: QBItem }>(facilityId, '/item?minorversion=65', {
      Name: 'Salon Services',
      Type: 'Service',
      IncomeAccountRef: { value: income.Id },
    })
    itemId = created.Item.Id
  }

  await db
    .insert(qbSyncState)
    .values({ facilityId, qbServiceItemId: itemId })
    .onConflictDoUpdate({
      target: [qbSyncState.facilityId],
      set: { qbServiceItemId: itemId, updatedAt: new Date() },
    })
  return itemId
}

type BillableBooking = {
  id: string
  residentId: string
  startTime: Date
  priceCents: number | null
  addonTotalCents: number | null
  serviceNames: string[] | null
  rawServiceName: string | null
  service: { name: string } | null
  resident: { id: string; name: string; poaEmail: string | null } | null
}

function bookingAmountCents(b: BillableBooking): number {
  // price_cents + addons only — never add tip_cents (tips are stylist comp)
  return (b.priceCents ?? 0) + (b.addonTotalCents ?? 0)
}

function bookingDescription(b: BillableBooking, tz: string, prefixResident: boolean): string {
  const names =
    b.serviceNames && b.serviceNames.length > 0
      ? b.serviceNames.join(', ')
      : b.service?.name ?? b.rawServiceName ?? 'Salon services'
  const p = getLocalParts(b.startTime, tz)
  const dateLabel = `${p.month}/${p.day}`
  const base = `${dateLabel} — ${names}`
  return prefixResident && b.resident ? `${b.resident.name}: ${base}` : base
}

function serviceDate(b: BillableBooking, tz: string): string {
  const p = getLocalParts(b.startTime, tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

// One push per facility at a time (same-instance double-click / two-operator
// guard — the billable set is only claimed AFTER each slow QB create, so
// concurrent runs would double-bill). Cross-instance races are additionally
// narrowed by the per-group re-check inside the loop.
const pushInFlight = new Map<string, Promise<unknown>>()

export async function pushQBInvoices(
  facilityId: string,
  opts: {
    month: string
    mode: 'per_resident' | 'facility'
    residentId?: string | null
    send?: boolean
    email?: string | null
    createdBy?: string | null
  },
): Promise<PushQBInvoicesResult> {
  if (pushInFlight.has(facilityId)) {
    throw new Error('A Send via QB run is already in progress for this facility — wait for it to finish')
  }
  const run = pushQBInvoicesInner(facilityId, opts).finally(() => {
    pushInFlight.delete(facilityId)
  })
  pushInFlight.set(facilityId, run)
  return run
}

async function pushQBInvoicesInner(
  facilityId: string,
  opts: {
    month: string
    mode: 'per_resident' | 'facility'
    residentId?: string | null
    send?: boolean
    email?: string | null
    createdBy?: string | null
  },
): Promise<PushQBInvoicesResult> {
  await ensureQbLinksSchema()
  await ensureQbSafetySchema()
  const { month, mode, residentId = null, send = false, email = null, createdBy = null } = opts
  const startedAt = new Date()
  const runItems: PushInvoiceRunItems['invoices'] = []
  const result: PushQBInvoicesResult = {
    invoices: [],
    totalCents: 0,
    skippedNoEmail: 0,
    skippedAutopay: 0,
    nothingToBill: false,
    errors: [],
    runId: null,
  }

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityId),
    columns: { id: true, name: true, timezone: true, contactEmail: true, qbRealmId: true },
  })
  if (!facility?.qbRealmId) throw new Error('QuickBooks not connected for this facility')
  const tz = facility.timezone ?? 'America/New_York'

  const range = monthRangeInTimezone(month, tz)
  if (!range) throw new Error('Invalid month')

  // Billable = completed, UNPAID, active, real (non-demo), not already tied to
  // an invoice. A booking already paid by cash/card must never be invoiced.
  const billable = (await db.query.bookings.findMany({
    where: and(
      eq(bookings.facilityId, facilityId),
      eq(bookings.status, 'completed'),
      eq(bookings.paymentStatus, 'unpaid'),
      eq(bookings.active, true),
      eq(bookings.isDemo, false), // is_demo filter — Phase 13
      isNull(bookings.qbInvoiceMatchId),
      gte(bookings.startTime, range.start),
      lt(bookings.startTime, range.end),
      ...(residentId ? [eq(bookings.residentId, residentId)] : []),
    ),
    columns: {
      id: true,
      residentId: true,
      startTime: true,
      priceCents: true,
      addonTotalCents: true,
      serviceNames: true,
      rawServiceName: true,
    },
    with: {
      service: { columns: { name: true } },
      resident: { columns: { id: true, name: true, poaEmail: true } },
    },
    orderBy: (b, { asc }) => [asc(b.startTime)],
  })) as unknown as BillableBooking[]

  const priced = billable.filter((b) => bookingAmountCents(b) > 0)

  // SAFEGUARD: card-on-file AUTOPAY residents are collected on the site (charge
  // on finalize / nightly sweep). Creating a QuickBooks invoice for them would
  // leave an open invoice in the books that the site then pays by card —
  // inviting a second collection through QB. Skip them and report the count.
  const autopayRows = await db
    .select({ id: residents.id })
    .from(residents)
    .innerJoin(
      paymentMethods,
      and(eq(paymentMethods.residentId, residents.id), eq(paymentMethods.active, true)),
    )
    .where(and(eq(residents.facilityId, facilityId), eq(residents.autopayEnabled, true)))
  const autopayIds = new Set(autopayRows.map((r) => r.id))
  const skippedAutopayResidents = new Set<string>()
  const withAmount = priced.filter((b) => {
    if (autopayIds.has(b.residentId)) {
      skippedAutopayResidents.add(b.residentId)
      return false
    }
    return true
  })
  result.skippedAutopay = skippedAutopayResidents.size

  if (withAmount.length === 0) {
    result.nothingToBill = true
    return result
  }

  const itemId = await ensureQBServiceItem(facilityId)

  // Group into invoices.
  const groups: Array<{ residentId: string | null; rows: BillableBooking[] }> = []
  if (mode === 'facility') {
    groups.push({ residentId: null, rows: withAmount })
  } else {
    const byResident = new Map<string, BillableBooking[]>()
    for (const b of withAmount) {
      const list = byResident.get(b.residentId) ?? []
      list.push(b)
      byResident.set(b.residentId, list)
    }
    for (const [rid, rows] of byResident) groups.push({ residentId: rid, rows })
    groups.sort((a, b) =>
      (a.rows[0].resident?.name ?? '').localeCompare(b.rows[0].resident?.name ?? ''),
    )
  }

  if (groups.length > INVOICE_CAP_PER_RUN) {
    result.errors.push(
      `Stopped after ${INVOICE_CAP_PER_RUN} invoices — run Send via QB again for the rest`,
    )
  }

  for (const group of groups.slice(0, INVOICE_CAP_PER_RUN)) {
    const residentName = group.rows[0].resident?.name ?? null
    const label = residentName ?? facility.name
    try {
      // Cross-instance race narrowing: re-check that these bookings are still
      // uninvoiced right before creating (a concurrent push in another lambda
      // may have claimed them since the initial select).
      const stillFree = await db.query.bookings.findMany({
        where: and(
          inArray(bookings.id, group.rows.map((b) => b.id)),
          isNull(bookings.qbInvoiceMatchId),
          eq(bookings.paymentStatus, 'unpaid'),
        ),
        columns: { id: true },
      })
      if (stillFree.length === 0) continue
      if (stillFree.length < group.rows.length) {
        const freeIds = new Set(stillFree.map((b) => b.id))
        group.rows = group.rows.filter((b) => freeIds.has(b.id))
      }

      const customerId =
        mode === 'facility' || !group.residentId
          ? await ensureQBFacilityParent(facilityId)
          : await ensureQBCustomerForResident(facilityId, group.residentId)

      const amountCents = group.rows.reduce((sum, b) => sum + bookingAmountCents(b), 0)
      const lines = group.rows.map((b) => ({
        DetailType: 'SalesItemLineDetail',
        Amount: bookingAmountCents(b) / 100,
        Description: bookingDescription(b, tz, mode === 'facility'),
        SalesItemLineDetail: {
          ItemRef: { value: itemId },
          ServiceDate: serviceDate(b, tz),
        },
      }))

      const created = await qbPost<{ Invoice: QBInvoiceEntity }>(
        facilityId,
        '/invoice?minorversion=65',
        {
          CustomerRef: { value: customerId },
          Line: lines,
          PrivateNote: `Senior Stylist — ${month} services`,
        },
      )
      const inv = created.Invoice
      const invoiceNum = inv.DocNumber ?? inv.Id
      const invoiceDate = inv.TxnDate ?? serviceDate(group.rows[0], tz)

      // Write the local copy so the nightly pull recognizes it, then link the
      // bookings so a re-push re-selects only what's still uninvoiced. All QB
      // HTTP stays OUTSIDE transactions (max:1 pool) — a crash between these
      // writes leaves at worst an unlinked local copy the pull reconciles.
      const [localRow] = await db
        .insert(qbInvoices)
        .values({
          facilityId,
          residentId: group.residentId,
          qbCustomerId: null,
          invoiceNum,
          invoiceDate,
          amountCents,
          openBalanceCents: amountCents,
          status: 'open',
          qbInvoiceId: inv.Id,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [qbInvoices.invoiceNum, qbInvoices.facilityId, qbInvoices.invoiceDate],
          set: {
            residentId: sql`excluded.resident_id`,
            amountCents: sql`excluded.amount_cents`,
            openBalanceCents: sql`excluded.open_balance_cents`,
            status: sql`excluded.status`,
            qbInvoiceId: sql`excluded.qb_invoice_id`,
            syncedAt: sql`excluded.synced_at`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: qbInvoices.id })

      await db
        .update(bookings)
        .set({ qbInvoiceMatchId: localRow.id, updatedAt: new Date() })
        .where(inArray(bookings.id, group.rows.map((b) => b.id)))
      runItems.push({
        qbInvoiceId: inv.Id,
        localInvoiceId: localRow.id,
        bookingIds: group.rows.map((b) => b.id),
        residentId: group.residentId,
        residentName,
        amountCents,
      })

      // Optional: QuickBooks emails the invoice.
      let emailed = false
      let emailError: string | undefined
      if (send) {
        const to =
          mode === 'facility'
            ? (email ?? facility.contactEmail)
            : (email ?? group.rows[0].resident?.poaEmail ?? null)
        if (!to) {
          result.skippedNoEmail++
        } else {
          try {
            // Intuit's send endpoint requires application/octet-stream + empty
            // body — a JSON body is rejected.
            await qbPostSend(
              facilityId,
              `/invoice/${inv.Id}/send?sendTo=${encodeURIComponent(to)}&minorversion=65`,
            )
            emailed = true
            await db
              .update(qbInvoices)
              .set({ lastSentAt: new Date(), sentVia: 'quickbooks', updatedAt: new Date() })
              .where(eq(qbInvoices.id, localRow.id))
          } catch (err) {
            emailError = `Invoice created but email failed: ${(err as Error).message?.slice(0, 150)}`
          }
        }
      }

      result.invoices.push({
        residentId: group.residentId,
        residentName,
        qbInvoiceId: inv.Id,
        docNumber: inv.DocNumber ?? null,
        bookings: group.rows.length,
        amountCents,
        emailed,
        ...(emailError ? { error: emailError } : {}),
      })
      result.totalCents += amountCents
      if (emailError) result.errors.push(`${label}: ${emailError}`)
    } catch (err) {
      result.errors.push(`${label}: ${(err as Error).message?.slice(0, 200)}`)
    }
  }

  // Fresh open invoices change outstanding balances — recompute (same SQL as
  // the invoice pull; always derived from local rows, safe after partial runs).
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

  // Audit + undo record — "Undo" voids these invoices in QB and re-frees the bookings.
  if (runItems.length > 0) {
    result.runId = await recordSyncRun({
      facilityId,
      action: 'push_invoice',
      startedAt,
      createdBy,
      summary: {
        month,
        mode,
        invoices: runItems.length,
        totalCents: result.totalCents,
        emailed: result.invoices.filter((i) => i.emailed).length,
        skippedAutopay: result.skippedAutopay,
        errors: result.errors.slice(0, 5),
      },
      items: { month, mode, invoices: runItems },
    })
  }

  return result
}
