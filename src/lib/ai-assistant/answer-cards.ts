// P47 — rich answer cards for the AI assistant.
//
// CONTRACT (do not regress):
// - Cards are built DETERMINISTICALLY BY TOOLS from their own query data —
//   the model NEVER authors a card (no hallucinated numbers can reach a card).
// - Pure module: no db/react imports. Shared by tools.ts (builders), gemini.ts
//   (accumulator), the client (renderer + persistence validation), and the
//   keyless harness.
// - Builders consume the tool's already-shaped response rows (money already
//   formatted as "$x.xx" strings where the tool formatted it) and return
//   AnswerCard | null (null when there is nothing to show).
// - Entities on cells/items make them tappable in the chat (openPeek). Only
//   attach an entity when the tool's own response exposed that id to this
//   role — cards must never widen data beyond the tool response.

export interface CardEntity {
  type: 'resident' | 'stylist'
  id: string
}

export interface CardCell {
  text: string
  entity?: CardEntity
}

export type AnswerCard =
  | { kind: 'table'; title: string; columns: string[]; rows: CardCell[][] }
  | { kind: 'stats'; title: string; stats: Array<{ label: string; value: string; hint?: string }> }
  | { kind: 'list'; title: string; items: Array<{ text: string; secondary?: string; entity?: CardEntity }> }

/** Hard cap per assistant turn — gemini.ts enforces it at the accumulator. */
export const MAX_CARDS_PER_TURN = 3
/** Row/item cap per card — bounds render height AND localStorage size. */
export const MAX_CARD_ROWS = 8

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isEntity(v: unknown): v is CardEntity {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return (e.type === 'resident' || e.type === 'stylist') && typeof e.id === 'string' && UUID_RE.test(e.id)
}

function isCell(v: unknown): v is CardCell {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  if (typeof c.text !== 'string') return false
  return c.entity === undefined || isEntity(c.entity)
}

/** Structural validator — used by the client when restoring persisted chats
 * and when accepting `done` payloads, so a corrupted blob can never render. */
export function isAnswerCard(v: unknown): v is AnswerCard {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  if (typeof c.title !== 'string') return false
  if (c.kind === 'table') {
    return (
      Array.isArray(c.columns) && c.columns.every((x) => typeof x === 'string') &&
      Array.isArray(c.rows) && c.rows.every((r) => Array.isArray(r) && r.every(isCell))
    )
  }
  if (c.kind === 'stats') {
    return (
      Array.isArray(c.stats) &&
      c.stats.every((s) => {
        if (!s || typeof s !== 'object') return false
        const t = s as Record<string, unknown>
        return typeof t.label === 'string' && typeof t.value === 'string' && (t.hint === undefined || typeof t.hint === 'string')
      })
    )
  }
  if (c.kind === 'list') {
    return (
      Array.isArray(c.items) &&
      c.items.every((i) => {
        if (!i || typeof i !== 'object') return false
        const t = i as Record<string, unknown>
        return (
          typeof t.text === 'string' &&
          (t.secondary === undefined || typeof t.secondary === 'string') &&
          (t.entity === undefined || isEntity(t.entity))
        )
      })
    )
  }
  return false
}

/** cents → "$1,234.56" (display formatting only — never re-derives sums). */
function fmtCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

const cell = (text: string, entity?: CardEntity): CardCell => (entity ? { text, entity } : { text })

// ---------------------------------------------------------------------------
// Builders — one per card-emitting tool, consuming the tool's shaped rows.
// ---------------------------------------------------------------------------

export function scheduleCard(
  date: string,
  rows: Array<{
    when: string
    resident: string
    residentId?: string | null
    room?: string | null
    service: string
    stylist?: string | null
    status: string
  }>,
): AnswerCard | null {
  if (rows.length === 0) return null
  return {
    kind: 'table',
    title: `Schedule · ${date}`,
    columns: ['Time', 'Resident', 'Room', 'Service', 'Stylist', 'Status'],
    rows: rows.slice(0, MAX_CARD_ROWS).map((r) => [
      // "Thu, Jul 23 · 10:00 AM" → keep just the time for the compact cell
      cell(r.when.split('·').pop()?.trim() ?? r.when),
      cell(r.resident, r.residentId ? { type: 'resident', id: r.residentId } : undefined),
      cell(r.room ?? '—'),
      cell(r.service),
      cell(r.stylist ?? '—'),
      cell(r.status),
    ]),
  }
}

export function ledgerCards(input: {
  resident: string
  residentId?: string | null
  owed: string
  availableCredit: string
  openInvoices: Array<{ num: string | null; date: string; open: string; status: string | null }>
}): AnswerCard[] {
  const cards: AnswerCard[] = [
    {
      kind: 'stats',
      title: `${input.resident} — account`,
      stats: [
        { label: 'Owed', value: input.owed },
        { label: 'Available credit', value: input.availableCredit },
        { label: 'Open invoices', value: String(input.openInvoices.length) },
      ],
    },
  ]
  if (input.openInvoices.length > 0) {
    cards.push({
      kind: 'table',
      title: 'Open invoices',
      columns: ['Invoice', 'Date', 'Open', 'Status'],
      rows: input.openInvoices.slice(0, MAX_CARD_ROWS).map((i) => [
        cell(i.num ?? '—'),
        cell(i.date),
        cell(i.open),
        cell(i.status ?? '—'),
      ]),
    })
  }
  return cards
}

/** Facility OR network analyst pack → KPI stats + a top-balances table. */
export function moneyPackCards(pack: Record<string, unknown>): AnswerCard[] {
  const cards: AnswerCard[] = []
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

  if (pack.scope === 'facility') {
    const fac = (pack.facility ?? {}) as Record<string, unknown>
    const revenue = (pack.revenue ?? {}) as Record<string, unknown>
    const billing = (pack.billing ?? {}) as Record<string, unknown>
    cards.push({
      kind: 'stats',
      title: `${typeof fac.name === 'string' ? fac.name : 'Facility'} — numbers`,
      stats: [
        { label: 'Revenue this month', value: fmtCents(num(revenue.thisMonthCents)), hint: `${num(revenue.thisMonthVisits)} visits` },
        { label: 'Open balances', value: fmtCents(num(billing.openInvoicesTotalCents)) },
        { label: 'Collected (30d)', value: fmtCents(num(billing.collectedLast30DaysCents)) },
        { label: 'Last month', value: fmtCents(num(revenue.lastMonthCents)), hint: `${num(revenue.lastMonthVisits)} visits` },
      ],
    })
    const top = Array.isArray(billing.topOpenResidentBalances) ? billing.topOpenResidentBalances : []
    if (top.length > 0) {
      cards.push({
        kind: 'table',
        title: 'Top open balances',
        columns: ['Resident', 'Owed'],
        rows: (top as Array<Record<string, unknown>>).slice(0, MAX_CARD_ROWS).map((r) => [
          cell(
            typeof r.resident === 'string' ? r.resident : '—',
            typeof r.residentId === 'string' && UUID_RE.test(r.residentId)
              ? { type: 'resident', id: r.residentId }
              : undefined,
          ),
          cell(fmtCents(num(r.owedCents))),
        ]),
      })
    }
    return cards
  }

  if (pack.scope === 'network') {
    const totals = (pack.totals ?? {}) as Record<string, unknown>
    cards.push({
      kind: 'stats',
      title: 'Network — this month',
      stats: [
        { label: 'Revenue (MTD)', value: fmtCents(num(totals.monthToDateRevenueCents)), hint: `${num(totals.monthToDateVisits)} visits` },
        { label: 'Open balances', value: fmtCents(num(totals.openBalanceCents)) },
        { label: 'Collected (30d)', value: fmtCents(num(totals.collectedLast30DaysCents)) },
        { label: 'Facilities', value: String(num(totals.facilities)) },
      ],
    })
    const facs = Array.isArray(pack.facilities) ? (pack.facilities as Array<Record<string, unknown>>) : []
    const topFacs = [...facs].sort((a, b) => num(b.openBalanceCents) - num(a.openBalanceCents)).slice(0, MAX_CARD_ROWS)
    if (topFacs.length > 0) {
      cards.push({
        kind: 'table',
        title: 'Facilities by open balance',
        columns: ['Facility', 'Open', 'MTD revenue'],
        rows: topFacs.map((f) => [
          cell(typeof f.facility === 'string' ? f.facility : '—'),
          cell(fmtCents(num(f.openBalanceCents))),
          cell(fmtCents(num(f.monthToDateRevenueCents))),
        ]),
      })
    }
    return cards
  }

  return cards
}

export function rebookingCard(
  candidates: Array<{
    resident: string
    residentId?: string | null
    room?: string | null
    lastVisit: string
    daysSinceLastVisit: number
    usualCadenceDays: number
    usualService?: string | null
  }>,
): AnswerCard | null {
  if (candidates.length === 0) return null
  return {
    kind: 'list',
    title: 'Due for a visit',
    items: candidates.slice(0, MAX_CARD_ROWS).map((c) => ({
      text: `${c.resident}${c.room ? ` · Rm ${c.room}` : ''}`,
      secondary: `${c.daysSinceLastVisit} days since ${c.lastVisit} (usually every ${c.usualCadenceDays})${c.usualService ? ` · ${c.usualService}` : ''}`,
      ...(c.residentId ? { entity: { type: 'resident' as const, id: c.residentId } } : {}),
    })),
  }
}

export function gapsCard(
  date: string,
  gaps: Array<{
    stylist: string
    stylistId?: string | null
    blocks: Array<{ from: string; to: string; minutes: number }>
  }>,
): AnswerCard | null {
  if (gaps.length === 0) return null
  return {
    kind: 'list',
    title: `Open time · ${date}`,
    items: gaps.slice(0, MAX_CARD_ROWS).map((g) => ({
      text: g.stylist,
      secondary: g.blocks.map((b) => `${b.from}–${b.to} (${b.minutes} min)`).join(' · '),
      ...(g.stylistId ? { entity: { type: 'stylist' as const, id: g.stylistId } } : {}),
    })),
  }
}

export function earningsCard(input: {
  month: string
  completedVisits: number
  revenue: string
  estimatedCommission: string
  tips: string
}): AnswerCard {
  return {
    kind: 'stats',
    title: `Your earnings · ${input.month}`,
    stats: [
      { label: 'Completed visits', value: String(input.completedVisits) },
      { label: 'Revenue', value: input.revenue },
      { label: 'Est. commission', value: input.estimatedCommission },
      { label: 'Tips', value: input.tips },
    ],
  }
}

export function payrollDetailCard(
  period: string,
  stylists: Array<{ stylist: string; revenue: string; commission: string; tips: string; netPay: string }>,
): AnswerCard | null {
  if (stylists.length === 0) return null
  return {
    kind: 'table',
    title: `Payroll · ${period}`,
    columns: ['Stylist', 'Revenue', 'Commission', 'Tips', 'Net pay'],
    rows: stylists.slice(0, MAX_CARD_ROWS).map((s) => [
      cell(s.stylist),
      cell(s.revenue),
      cell(s.commission),
      cell(s.tips),
      cell(s.netPay),
    ]),
  }
}

export function payrollPeriodsCard(
  periods: Array<{ dates: string; status: string; stylists: number; totalPayout: string }>,
): AnswerCard | null {
  if (periods.length === 0) return null
  return {
    kind: 'table',
    title: 'Pay periods',
    columns: ['Dates', 'Status', 'Stylists', 'Total payout'],
    rows: periods.slice(0, MAX_CARD_ROWS).map((p) => [
      cell(p.dates),
      cell(p.status),
      cell(String(p.stylists)),
      cell(p.totalPayout),
    ]),
  }
}
