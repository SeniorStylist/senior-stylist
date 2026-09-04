// Turns one qb_sync_runs row into a two-sided, UUID-FREE breakdown of what
// changed: "In QuickBooks" vs "On the site". Pure — no db, no React. The API
// route does the (batched) lookups and hands the rows in here.
//
// Three rules make this honest rather than merely detailed:
//  1. NEVER infer an outcome from absence. A missing row means "no longer on
//     the site" — the cause is named only when this run's undo actually
//     deletes that row type.
//  2. A detail that was not recorded says so, per table. An empty table reads
//     as "nothing happened", which would be a lie.
//  3. Both pulls change NOTHING in QuickBooks. That is stated outright, because
//     an "Undo" button beside a list of payments otherwise reads like money is
//     about to be deleted from the books.

import { formatMoney } from '@/lib/format'
import type {
  CreditLabel,
  InvoiceLabel,
  PaymentLabel,
  PushInvoiceRunItems,
  SyncCustomersRunItems,
  SyncInvoicesRunItems,
  SyncPaymentsRunItems,
} from '@/lib/qb-runs'

export type Tone = 'default' | 'good' | 'warn' | 'muted'

export interface DetailCell {
  text: string
  tone?: Tone
  mono?: boolean
  align?: 'right'
}

export interface DetailRow {
  cells: DetailCell[]
  note?: string
  tone?: Tone
}

export interface DetailTable {
  title: string
  /** Plain-language explanation of what this table means. Always present. */
  caption: string
  columns: Array<{ label: string; align?: 'right' }>
  rows: DetailRow[]
  /** How many rows exist beyond the ones listed. */
  more?: number
  /** When set, this sentence renders INSTEAD of rows — the detail wasn't recorded. */
  unrecorded?: string
}

export interface DetailSide {
  headline: string
  note?: string
  tables: DetailTable[]
}

export interface RunDetail {
  id: string
  action: string
  actionLabel: string
  headline: string
  quickbooks: DetailSide
  site: DetailSide
  errors: string[]
  warnings: string[]
}

export const ACTION_LABELS: Record<string, string> = {
  push_invoice: 'Send via QB',
  sync_customers: 'Sync Customers',
  sync_invoices: 'Invoice sync from QuickBooks',
  sync_payments: 'Payment sync from QuickBooks',
}

/** Both pulls are read-only against QuickBooks — qb-invoice-sync.ts and
 *  qb-payment-sync.ts import qbGet and nothing else. */
const READ_ONLY_SIDE: DetailSide = {
  headline: 'Nothing was changed in QuickBooks.',
  note: 'This sync only reads from QuickBooks. Card payments collected on the site are written into QuickBooks separately, by the payment mirror.',
  tables: [],
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Resident + room, or a plain fallback — never a blank cell. */
export function personLabel(name: string | null | undefined, room: string | null | undefined): string {
  const n = str(name)
  const r = str(room)
  if (!n) return 'Unknown resident'
  return r ? `${n} (Rm ${r})` : n
}

function money(cents: number): DetailCell {
  return { text: formatMoney(cents), align: 'right', mono: true }
}

/** Context the route resolves from the DB before building. */
export interface DetailContext {
  facilityName: string
  /** Date-only strings ('YYYY-MM-DD') formatted in the facility's timezone. */
  formatDate: (yyyymmdd: string | null | undefined) => string
  /** Live invoice state by local id, for before→after and per-row undo truth. */
  invoiceById: Map<string, { invoiceNum: string; status: string | null; openBalanceCents: number }>
  /** Bookings resolved for legacy runs that recorded only ids. */
  bookingById: Map<string, { dateLabel: string; description: string; amountCents: number }>
  /** Whether this run has been undone, and how completely. */
  undone: boolean
  undoSkipped: number
}

// ── push_invoice ──────────────────────────────────────────────────────────

function buildPushInvoice(items: PushInvoiceRunItems, ctx: DetailContext): Pick<RunDetail, 'quickbooks' | 'site'> {
  const invoices = items.invoices ?? []
  const total = invoices.reduce((s, i) => s + num(i.amountCents), 0)

  const invoiceRows: DetailRow[] = invoices.map((i) => {
    const live = ctx.invoiceById.get(i.localInvoiceId)
    const numLabel = i.invoiceNum ?? live?.invoiceNum ?? 'Invoice'
    // Per-row undo truth: 'void' is written ONLY by an undo, so a run can never
    // claim "all voided" over invoices it actually left alone.
    const voided = live?.status === 'void'
    const emailNote =
      i.emailed === true
        ? `Emailed by QuickBooks to ${i.emailedTo ?? 'the address on file'}`
        : i.emailed === false && i.emailError
          ? `Email failed: ${i.emailError}`
          : i.emailed === false
            ? 'Not emailed — no email address on file'
            : undefined
    return {
      cells: [
        { text: numLabel, mono: true },
        { text: i.residentName ? personLabel(i.residentName, null) : ctx.facilityName },
        { text: ctx.formatDate(i.invoiceDate) },
        money(num(i.amountCents)),
        {
          text: voided ? 'Voided' : ctx.undone ? 'Left alone' : 'Open',
          tone: voided ? 'muted' : ctx.undone ? 'warn' : 'good',
        },
      ],
      note: emailNote,
      tone: voided ? 'muted' : 'default',
    }
  })

  // Invoice lines: recorded per invoice since P60; older runs fall back to the
  // booking rows the site side already resolves.
  const lineRows: DetailRow[] = []
  let lineMore = 0
  let linesRecorded = false
  for (const i of invoices) {
    if (!i.bookings) continue
    linesRecorded = true
    lineMore += num(i.bookingsTruncated)
    for (const b of i.bookings) {
      lineRows.push({
        cells: [
          { text: ctx.formatDate(b.dateLabel) },
          { text: i.residentName ?? ctx.facilityName },
          { text: b.description },
          money(num(b.amountCents)),
        ],
      })
    }
  }
  if (!linesRecorded) {
    for (const i of invoices) {
      for (const id of i.bookingIds ?? []) {
        const b = ctx.bookingById.get(id)
        if (!b) continue
        lineRows.push({
          cells: [
            { text: b.dateLabel },
            { text: i.residentName ?? ctx.facilityName },
            { text: b.description },
            money(b.amountCents),
          ],
        })
      }
    }
  }

  const qbTables: DetailTable[] = [
    {
      title: 'Invoices created',
      caption:
        'These invoices now exist in QuickBooks. The number is the one you can search on there.',
      columns: [
        { label: 'Invoice #' },
        { label: 'Customer' },
        { label: 'Date' },
        { label: 'Amount', align: 'right' },
        { label: 'State' },
      ],
      rows: invoiceRows,
      ...(invoiceRows.length === 0
        ? { unrecorded: 'No invoice was created — see the errors below.' }
        : {}),
    },
  ]

  if (items.createdCustomers?.length) {
    qbTables.push({
      title: 'Customers created',
      caption:
        'Creating an invoice also creates the customer it bills when one doesn’t exist yet. Undoing this run does NOT remove these — delete them in QuickBooks if you don’t want them.',
      columns: [{ label: 'QuickBooks customer' }, { label: 'Type' }],
      rows: items.createdCustomers.map((c) => ({
        cells: [{ text: c.displayName, mono: true }, { text: c.kind === 'facility' ? 'Facility' : 'Resident' }],
        tone: 'warn',
      })),
    })
  }

  if (items.serviceItemCreated) {
    qbTables.push({
      title: 'Service item created',
      caption:
        'The first push to a facility creates the product/service invoice lines are billed against. It stays for every future invoice.',
      columns: [{ label: 'Item' }, { label: 'Posts to' }],
      rows: [
        {
          cells: [
            { text: items.serviceItemCreated.name, mono: true },
            { text: items.serviceItemCreated.incomeAccountName ?? 'an income account' },
          ],
        },
      ],
    })
  }

  const siteTables: DetailTable[] = [
    {
      title: 'Appointments marked as billed',
      caption:
        'The visits these invoices cover. They no longer appear as unbilled — undoing this run frees them to be billed again.',
      columns: [
        { label: 'Date' },
        { label: 'Resident' },
        { label: 'Service' },
        { label: 'Amount', align: 'right' },
      ],
      rows: lineRows,
      ...(lineMore ? { more: lineMore } : {}),
      ...(lineRows.length === 0
        ? { unrecorded: 'The individual visits weren’t recorded for this run.' }
        : {}),
    },
  ]

  if (items.skippedAutopay?.length) {
    siteTables.push({
      title: 'Deliberately not invoiced',
      caption:
        'These residents pay by card on file, so the site collects from them directly. Invoicing them in QuickBooks would risk charging them twice.',
      columns: [
        { label: 'Resident' },
        { label: 'Visits', align: 'right' },
        { label: 'Amount', align: 'right' },
      ],
      rows: items.skippedAutopay.map((s) => ({
        cells: [
          { text: personLabel(s.residentName, s.roomNumber) },
          { text: String(s.bookingCount), align: 'right' },
          money(num(s.amountCents)),
        ],
        tone: 'muted',
      })),
    })
  }

  return {
    quickbooks: {
      headline:
        invoiceRows.length > 0
          ? `Created ${invoiceRows.length} invoice${invoiceRows.length === 1 ? '' : 's'}, ${formatMoney(total)} in total.`
          : 'No invoice was created in QuickBooks.',
      tables: qbTables,
    },
    site: {
      headline: `${invoiceRows.length} invoice${invoiceRows.length === 1 ? '' : 's'} recorded here, and the visits behind ${invoiceRows.length === 1 ? 'it' : 'them'} marked as billed.`,
      note: 'Facility and resident outstanding balances were recalculated afterwards.',
      tables: siteTables,
    },
  }
}

// ── sync_customers ────────────────────────────────────────────────────────

const MATCH_METHOD_LABEL: Record<string, string> = {
  stored_name: 'Saved QuickBooks name',
  display_name: 'Exact name',
  exact_name: 'Exact name',
  fuzzy: 'Close name match',
}

function buildSyncCustomers(
  items: SyncCustomersRunItems,
  ctx: DetailContext,
  summary: Record<string, unknown>,
): Pick<RunDetail, 'quickbooks' | 'site'> {
  const created = items.createdLinks ?? []
  const matched = items.matchedLinks ?? []
  const matchedCount = num(summary.matchedExisting)

  const qbTables: DetailTable[] = [
    {
      title: 'Customers created in QuickBooks',
      caption:
        'Residents who had no QuickBooks customer yet. They were added under the facility’s customer.',
      columns: [{ label: 'QuickBooks customer' }],
      rows: created.map((c) => ({
        cells: [{ text: c.displayName ?? 'Unnamed customer', mono: true }],
      })),
      ...(created.length === 0
        ? { unrecorded: 'No new customers were needed — everyone already existed in QuickBooks.' }
        : {}),
    },
  ]

  if (items.parentCustomer) {
    qbTables.push({
      title: 'Facility customer',
      caption: items.parentCustomer.created
        ? 'The facility had no customer in QuickBooks, so one was created. Residents hang underneath it.'
        : 'The existing QuickBooks customer this facility’s residents are filed under.',
      columns: [{ label: 'QuickBooks customer' }, { label: 'Result' }],
      rows: [
        {
          cells: [
            { text: items.parentCustomer.displayName ?? 'Unnamed customer', mono: true },
            { text: items.parentCustomer.created ? 'Created' : 'Matched' },
          ],
          note: items.parentCustomer.repointedFrom
            ? 'Heads up: this run pointed the facility at a DIFFERENT QuickBooks customer than before. Future invoices will go there.'
            : undefined,
          tone: items.parentCustomer.repointedFrom ? 'warn' : 'default',
        },
      ],
    })
  }

  const siteTables: DetailTable[] = [
    {
      title: 'Residents linked to a QuickBooks customer',
      caption:
        'The link that decides which QuickBooks customer a resident’s invoices and payments belong to.',
      columns: [{ label: 'Resident' }, { label: 'QuickBooks customer' }, { label: 'Matched by' }],
      rows: matched.map((m) => ({
        cells: [
          { text: personLabel(m.residentName, m.roomNumber) },
          { text: m.qbDisplayName ?? '—', mono: true },
          {
            text: MATCH_METHOD_LABEL[m.matchMethod] ?? m.matchMethod,
            tone: m.matchMethod === 'fuzzy' ? 'warn' : 'muted',
          },
        ],
        note:
          m.matchMethod === 'fuzzy'
            ? 'Matched on a similar name rather than an exact one — worth a glance.'
            : undefined,
      })),
      ...(matched.length ? {} : {}),
      ...(items.matchedTruncated ? { more: items.matchedTruncated } : {}),
      ...(matched.length === 0 && matchedCount > 0
        ? {
            unrecorded: `${matchedCount} resident${matchedCount === 1 ? ' was' : 's were'} matched to a customer that already existed, but the names weren’t recorded for this run.`,
          }
        : {}),
      ...(matched.length === 0 && matchedCount === 0
        ? { unrecorded: 'No residents were matched to existing QuickBooks customers.' }
        : {}),
    },
  ]

  const createdCount = created.length
  return {
    quickbooks: {
      headline:
        createdCount > 0
          ? `Created ${createdCount} customer${createdCount === 1 ? '' : 's'} in QuickBooks.`
          : 'No customers were created in QuickBooks.',
      note:
        matchedCount > 0
          ? `${matchedCount} resident${matchedCount === 1 ? '' : 's'} already had a customer there and ${matchedCount === 1 ? 'was' : 'were'} linked, not duplicated.`
          : undefined,
      tables: qbTables,
    },
    site: {
      headline: `${createdCount + matchedCount} resident${createdCount + matchedCount === 1 ? '' : 's'} now linked to QuickBooks.`,
      note: 'Undoing this run removes the links and deactivates the customers it created. Customers that already existed are left alone.',
      tables: siteTables,
    },
  }
}

// ── sync_invoices (pull) ──────────────────────────────────────────────────

function invoiceLabelRow(l: InvoiceLabel, ctx: DetailContext): DetailRow {
  return {
    cells: [
      { text: l.invoiceNum, mono: true },
      { text: personLabel(l.residentName, l.roomNumber) },
      { text: ctx.formatDate(l.invoiceDate) },
      money(num(l.amountCents)),
      money(num(l.openBalanceCents)),
    ],
  }
}

function buildSyncInvoices(
  items: SyncInvoicesRunItems,
  ctx: DetailContext,
): Pick<RunDetail, 'quickbooks' | 'site'> {
  const updated = items.updated ?? []
  const inserted = items.insertedInvoices ?? []
  const insertedIds = items.insertedInvoiceIds ?? []

  const updatedRows: DetailRow[] = updated.map((u) => {
    const live = ctx.invoiceById.get(u.id)
    const newOpen = u.newOpenBalanceCents ?? live?.openBalanceCents ?? null
    const newStatus = u.newStatus ?? live?.status ?? null
    return {
      cells: [
        { text: u.label?.invoiceNum ?? live?.invoiceNum ?? 'Invoice', mono: true },
        { text: personLabel(u.label?.residentName, u.label?.roomNumber) },
        money(num(u.prevOpenBalanceCents)),
        newOpen === null ? { text: '—', align: 'right' } : money(newOpen),
        { text: `${u.prevStatus} → ${newStatus ?? '—'}`, tone: 'muted' },
      ],
    }
  })

  const insertedRows: DetailRow[] = inserted.length
    ? inserted.map((l) => invoiceLabelRow(l, ctx))
    : insertedIds
        .map((id) => ctx.invoiceById.get(id))
        .filter((v): v is NonNullable<typeof v> => !!v)
        .map((v) => ({
          cells: [
            { text: v.invoiceNum, mono: true },
            { text: '—' },
            { text: '—' },
            { text: '—', align: 'right' },
            money(v.openBalanceCents),
          ],
        }))

  const siteTables: DetailTable[] = [
    {
      title: 'Invoices added from QuickBooks',
      caption: 'Invoices that existed in QuickBooks but not here yet.',
      columns: [
        { label: 'Invoice #' },
        { label: 'Resident' },
        { label: 'Date' },
        { label: 'Amount', align: 'right' },
        { label: 'Open', align: 'right' },
      ],
      rows: insertedRows,
      ...(items.insertedInvoicesTruncated ? { more: items.insertedInvoicesTruncated } : {}),
      ...(insertedRows.length === 0 && insertedIds.length > 0
        ? {
            unrecorded: `${insertedIds.length} invoice${insertedIds.length === 1 ? ' was' : 's were'} added, but ${insertedIds.length === 1 ? 'it is' : 'they are'} no longer on the site${ctx.undone ? ' — this run was undone, which removes them.' : '.'}`,
          }
        : {}),
      ...(insertedRows.length === 0 && insertedIds.length === 0
        ? { unrecorded: 'No new invoices came across.' }
        : {}),
    },
    {
      title: 'Balances updated from QuickBooks',
      caption: ctx.undone
        ? 'These balances were changed by the sync and then restored when it was undone.'
        : 'QuickBooks was treated as the source of truth for these balances.',
      columns: [
        { label: 'Invoice #' },
        { label: 'Resident' },
        { label: 'Was', align: 'right' },
        { label: ctx.undone ? 'Set to' : 'Now', align: 'right' },
        { label: 'Status' },
      ],
      rows: updatedRows,
      ...(updatedRows.length === 0 ? { unrecorded: 'No balances changed.' } : {}),
    },
  ]

  if (items.ambiguous?.length) {
    siteTables.push({
      title: 'Held down for money already collected here',
      caption:
        'QuickBooks and this site BOTH show a payment on these invoices. The site is showing the lower balance so nobody gets charged twice — confirm in QuickBooks whether it is the same payment or a second one.',
      columns: [
        { label: 'Invoice #' },
        { label: 'Resident' },
        { label: 'Open in QB', align: 'right' },
        { label: 'Paid here', align: 'right' },
      ],
      rows: items.ambiguous.map((a) => ({
        cells: [
          { text: a.invoiceNum, mono: true },
          { text: personLabel(a.residentName, null) },
          money(num(a.qbOpenCents)),
          money(num(a.sitePaidCents)),
        ],
        tone: 'warn',
      })),
    })
  }

  return {
    quickbooks: READ_ONLY_SIDE,
    site: {
      headline: `${insertedRows.length || insertedIds.length} invoice${(insertedRows.length || insertedIds.length) === 1 ? '' : 's'} added, ${updatedRows.length} updated.`,
      note: 'Facility and resident outstanding balances were recalculated from these invoices. Money collected on the site is always re-applied afterwards, so a balance can end up lower than QuickBooks shows.',
      tables: siteTables,
    },
  }
}

// ── sync_payments (pull) ──────────────────────────────────────────────────

function paymentRow(l: PaymentLabel, ctx: DetailContext, extra?: DetailCell[]): DetailRow {
  return {
    cells: [
      { text: l.checkNum ?? '—', mono: true },
      { text: ctx.formatDate(l.paymentDate) },
      money(num(l.amountCents)),
      { text: personLabel(l.residentName, l.roomNumber) },
      ...(extra ?? []),
    ],
  }
}

const PAYMENT_COLUMNS = [
  { label: 'Check #' },
  { label: 'Date' },
  { label: 'Amount', align: 'right' as const },
  { label: 'Resident' },
]

function buildSyncPayments(
  items: SyncPaymentsRunItems,
  ctx: DetailContext,
): Pick<RunDetail, 'quickbooks' | 'site'> {
  const insertedLabels = items.insertedPayments ?? []
  const insertedIds = items.insertedPaymentIds ?? []
  const stamped = items.stamped ?? []
  const upgraded = items.upgraded ?? []
  const refreshed = items.refreshed ?? []
  const creditLabels = items.insertedCredits ?? []
  const creditIds = items.insertedCreditIds ?? []

  const labelled = <T extends { label?: PaymentLabel }>(rows: T[]): PaymentLabel[] =>
    rows.map((r) => r.label).filter((l): l is PaymentLabel => !!l)

  const stampedLabels = labelled(stamped)
  const upgradedLabels = labelled(upgraded)

  const tables: DetailTable[] = [
    {
      title: 'Payments added',
      caption: 'Payments that were in QuickBooks but not recorded here yet.',
      columns: PAYMENT_COLUMNS,
      rows: insertedLabels.map((l) => paymentRow(l, ctx)),
      ...(items.insertedPaymentsTruncated ? { more: items.insertedPaymentsTruncated } : {}),
      ...(insertedLabels.length === 0
        ? {
            unrecorded:
              insertedIds.length > 0
                ? `${insertedIds.length} payment${insertedIds.length === 1 ? ' was' : 's were'} added, but the details weren’t recorded for this run.`
                : 'No new payments came across.',
          }
        : {}),
    },
    {
      title: 'Already on the books',
      caption:
        'These were already recorded here — from a scanned check, a CSV import, or a card payment the site wrote into QuickBooks. They were linked to QuickBooks, not added a second time.',
      columns: PAYMENT_COLUMNS,
      rows: stampedLabels.map((l) => paymentRow(l, ctx)),
      ...(stampedLabels.length === 0
        ? {
            unrecorded:
              stamped.length > 0
                ? `${stamped.length} payment${stamped.length === 1 ? ' was' : 's were'} matched to money already recorded here, but the details weren’t recorded for this run.`
                : 'Nothing needed linking.',
          }
        : {}),
    },
    {
      title: 'Credited to a resident',
      caption:
        'These arrived as facility payments and QuickBooks told us who they were actually for. The money moved onto that resident’s account.',
      columns: PAYMENT_COLUMNS,
      rows: upgradedLabels.map((l) => paymentRow(l, ctx)),
      ...(upgradedLabels.length === 0
        ? {
            unrecorded:
              upgraded.length > 0
                ? `${upgraded.length} payment${upgraded.length === 1 ? ' was' : 's were'} re-credited, but the residents weren’t recorded for this run.`
                : 'Nothing was re-credited.',
          }
        : {}),
    },
    {
      title: 'Amounts corrected from QuickBooks',
      caption: 'Payments that had been edited in QuickBooks since we last read them.',
      columns: [
        { label: 'Check #' },
        { label: 'Resident' },
        { label: 'Was', align: 'right' },
        { label: ctx.undone ? 'Set to' : 'Now', align: 'right' },
        { label: 'Date' },
      ],
      rows: refreshed.map((r) => ({
        cells: [
          { text: r.label?.checkNum ?? '—', mono: true },
          { text: personLabel(r.label?.residentName, r.label?.roomNumber) },
          money(num(r.prevAmountCents)),
          r.newAmountCents === undefined
            ? { text: '—', align: 'right' as const }
            : money(num(r.newAmountCents)),
          {
            text:
              r.newPaymentDate && r.newPaymentDate !== r.prevPaymentDate
                ? `${ctx.formatDate(r.prevPaymentDate)} → ${ctx.formatDate(r.newPaymentDate)}`
                : ctx.formatDate(r.prevPaymentDate),
          },
        ],
      })),
      ...(refreshed.length === 0 ? { unrecorded: 'No amounts changed.' } : {}),
    },
    {
      title: 'Credits',
      caption:
        'Unapplied credits and credit memos from QuickBooks — money a resident has on account that hasn’t been put against an invoice yet.',
      columns: [
        { label: 'Type' },
        { label: 'Ref' },
        { label: 'Date' },
        { label: 'Open', align: 'right' },
        { label: 'Resident' },
      ],
      rows: creditLabels.map((c: CreditLabel) => ({
        cells: [
          { text: c.txnType ?? 'Credit' },
          { text: c.num ?? '—', mono: true },
          { text: ctx.formatDate(c.txnDate) },
          money(num(c.openBalanceCents)),
          { text: personLabel(c.residentName, null) },
        ],
      })),
      ...(items.insertedCreditsTruncated ? { more: items.insertedCreditsTruncated } : {}),
      ...(creditLabels.length === 0
        ? {
            unrecorded:
              creditIds.length > 0
                ? `${creditIds.length} credit${creditIds.length === 1 ? '' : 's'} came across, but the details weren’t recorded for this run.`
                : 'No credits came across.',
          }
        : {}),
    },
  ]

  const addedCount = insertedLabels.length || insertedIds.length
  return {
    quickbooks: READ_ONLY_SIDE,
    site: {
      headline: `${addedCount} payment${addedCount === 1 ? '' : 's'} added, ${upgraded.length} re-credited, ${refreshed.length} corrected.`,
      note: `Undoing this run removes what it added and rewinds the sync${
        items.prevLastSyncedAt ? '' : ' to the beginning'
      }, so the next sync covers the same window again. Resident balances are not changed by this sync.`,
      tables,
    },
  }
}

// ── entry point ───────────────────────────────────────────────────────────

/**
 * Build the two-sided breakdown. `items` comes straight out of the jsonb
 * column, so every access is defensive — a legacy shape, a null, or a future
 * action must degrade to "not recorded", never throw.
 */
export function buildRunDetail(opts: {
  id: string
  action: string
  items: Record<string, unknown> | null
  summary: Record<string, unknown> | null
  ctx: DetailContext
}): RunDetail {
  const { id, action, ctx } = opts
  const summary = opts.summary ?? {}
  const items = (opts.items ?? {}) as Record<string, unknown>
  const actionLabel = ACTION_LABELS[action] ?? action

  let sides: Pick<RunDetail, 'quickbooks' | 'site'>
  try {
    switch (action) {
      case 'push_invoice':
        sides = buildPushInvoice(items as unknown as PushInvoiceRunItems, ctx)
        break
      case 'sync_customers':
        sides = buildSyncCustomers(items as unknown as SyncCustomersRunItems, ctx, summary)
        break
      case 'sync_invoices':
        sides = buildSyncInvoices(items as unknown as SyncInvoicesRunItems, ctx)
        break
      case 'sync_payments':
        sides = buildSyncPayments(items as unknown as SyncPaymentsRunItems, ctx)
        break
      default:
        sides = {
          quickbooks: { headline: 'No detail was recorded for this operation.', tables: [] },
          site: { headline: 'No detail was recorded for this operation.', tables: [] },
        }
    }
  } catch (err) {
    console.error('[qb-run-detail] build failed:', err)
    sides = {
      quickbooks: { headline: 'This run’s detail could not be read.', tables: [] },
      site: { headline: 'This run’s detail could not be read.', tables: [] },
    }
  }

  const errors = Array.isArray(summary.errors) ? (summary.errors as unknown[]).map(String) : []
  const warnings = Array.isArray(summary.warnings) ? (summary.warnings as unknown[]).map(String) : []

  const headlineBits: string[] = [actionLabel]
  if (str(summary.month)) headlineBits.push(String(summary.month))
  if (summary.fullSync === true) headlineBits.push('full re-sync')
  if (summary.capped === true) headlineBits.push('stopped at the row limit — run it again')

  return {
    id,
    action,
    actionLabel,
    headline: headlineBits.join(' · '),
    quickbooks: sides.quickbooks,
    site: sides.site,
    errors,
    warnings,
  }
}
