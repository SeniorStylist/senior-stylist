// P38 — role-scoped tool registry for the AI personal assistant.
//
// SAFETY CONTRACT (do not regress):
// - The tool list handed to Gemini is FILTERED BY ROLE — a stylist's model
//   never even sees billing tools. Every execute() re-checks scope anyway.
// - READ tools run here, always scoped to ctx.facilityId (+ ctx.stylistId for
//   stylist role), active=true, is_demo=false, revenue = completed only.
// - WRITE tools NEVER mutate anything server-side. They resolve + validate
//   entities and return a `pendingAction` whose request body is built ONLY
//   from resolved values (closed per-kind field sets — the model can choose
//   WHICH entities, never arbitrary fields like priceCents). The CLIENT
//   executes the confirmed action against the existing REST endpoint with its
//   own session, so every guard/pricing/conflict/GCal/revalidate path runs
//   exactly as the normal UI. This is not a crypto boundary — it defends
//   against a prompt-injected model; the REST endpoints remain the authority.
// - max:1 pool: only `import { db } from '@/db'`; NO db.transaction anywhere
//   in the assistant path (it would pin the sole connection across multi-
//   second Gemini fetches).

import { db } from '@/db'
import { sql, and, eq, or, inArray, lt, gt, lte, gte, ne } from 'drizzle-orm'
import { z } from 'zod'
import {
  bookings, residents, services, stylists, stylistFacilityAssignments, facilities, residentPreferences,
  stylistAvailability, coverageRequests, qbInvoices, qbPayments, qbUnappliedCredits,
  waitlistEntries, signupSheetEntries, payPeriods, feedbackSubmissions,
} from '@/db/schema'
import { fuzzyScore } from '@/lib/fuzzy'
import {
  dayRangeInTimezone, fromDateTimeLocalInTz, toDateTimeLocalInTz, formatTimeInTz, formatDateInTz, getLocalParts,
} from '@/lib/time'
import { buildFacilityDataPack, buildMasterDataPack } from '@/lib/ai-analyst'
import { resolveCommission } from '@/lib/stylist-commission'

export interface AssistantCtx {
  userId: string
  /** Normalized role; 'master' for the env-email master admin. */
  role: 'admin' | 'facility_staff' | 'bookkeeper' | 'stylist' | 'viewer' | 'master'
  /** Null only for a plain master with no facility selected (network scope). */
  facilityId: string | null
  facilityName: string | null
  /** F-code like "F177" — fed to the prompt so codes are never read as names. */
  facilityCode: string | null
  timezone: string
  /** Effective stylist id (stylist role only — null = unlinked account). */
  stylistId: string | null
  stylistName: string | null
}

// P40 — the PendingAction shape + per-kind execution rules live in the shared
// allowlist module (single source for server tools, client hook, harness).
export type { PendingAction, AssistantActionKind } from './action-allowlist'
import type { PendingAction } from './action-allowlist'

export interface ToolResult {
  /** Fed back to the model as the functionResponse (always a JSON object). */
  response: Record<string, unknown>
  /** Present only when a write tool produced a proposal for the client. */
  pendingAction?: PendingAction
}

// Gemini functionDeclarations parameter schema (uppercase OpenAPI subset).
type GeminiSchema = Record<string, unknown>

export interface AssistantTool {
  name: string
  description: string
  parameters: GeminiSchema
  kind: 'read' | 'write'
  /** Roles that get this tool. 'master' covers facility-scoped master ctx. */
  roles: AssistantCtx['role'][]
  /** When true the tool needs ctx.facilityId (plain-master network ctx lacks it). */
  needsFacility: boolean
  execute: (ctx: AssistantCtx, args: Record<string, unknown>) => Promise<ToolResult>
}

const err = (message: string, extra?: Record<string, unknown>): ToolResult => ({
  response: { error: message, ...(extra ?? {}) },
})

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function whenLabel(d: Date, tz: string): string {
  return `${formatDateInTz(d, tz, { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatTimeInTz(d, tz)}`
}

/** Facility roster = home rows + active assignment-linked rows (F228 rule). */
async function facilityRoster(facilityId: string) {
  const assigned = await db
    .select({ stylistId: stylistFacilityAssignments.stylistId })
    .from(stylistFacilityAssignments)
    .where(and(eq(stylistFacilityAssignments.facilityId, facilityId), eq(stylistFacilityAssignments.active, true)))
  const assignedIds = assigned.map((a) => a.stylistId)
  return db.query.stylists.findMany({
    where: and(
      eq(stylists.active, true),
      eq(stylists.isDemo, false),
      assignedIds.length > 0
        ? or(eq(stylists.facilityId, facilityId), inArray(stylists.id, assignedIds))
        : eq(stylists.facilityId, facilityId),
    ),
    columns: { id: true, name: true },
  })
}

/** Normalized Levenshtein similarity (1 = identical). Catches MISSPELLINGS —
 * the word-overlap fuzzyScore scores "Adeel Kohen" vs "Adele Cohen" as 0. */
export function levSimilarity(a: string, b: string): number {
  const s = a.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  const t = b.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  if (!s || !t) return 0
  if (s === t) return 1
  const m = s.length
  const n = t.length
  if (Math.abs(m - n) > Math.max(m, n) * 0.6) return 0
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return 1 - prev[n] / Math.max(m, n)
}

/** Top fuzzy matches over a name list; ambiguous when the top two are within
 * 0.05. Combines word-overlap fuzzyScore with edit-distance similarity so
 * both word reorderings ("Smith, Edna") and misspellings ("Adeel Kohen" →
 * "Adele Cohen") rank. */
export function rankByName<T extends { name: string }>(items: T[], query: string) {
  const scored = items
    .map((item) => ({ item, score: Math.max(fuzzyScore(item.name, query), levSimilarity(item.name, query)) }))
    .filter((x) => x.score >= 0.45)
    .sort((a, b) => b.score - a.score)
  const ambiguous = scored.length >= 2 && scored[0].score - scored[1].score < 0.05
  return { scored: scored.slice(0, 5), ambiguous }
}

/** Parse a facility-local "YYYY-MM-DDTHH:mm" → UTC Date, with sanity bounds. */
export function parseLocalDateTime(raw: unknown, tz: string): { date: Date } | { error: string } {
  if (typeof raw !== 'string' || !DATETIME_LOCAL_RE.test(raw)) {
    return { error: 'dateTimeLocal must be formatted YYYY-MM-DDTHH:mm (facility-local time).' }
  }
  const date = fromDateTimeLocalInTz(raw, tz)
  if (Number.isNaN(date.getTime())) return { error: 'That date/time is not valid.' }
  const now = Date.now()
  if (date.getTime() < now - 60_000) {
    return { error: `That time is in the past — right now at the facility it is ${toDateTimeLocalInTz(new Date(), tz)}.` }
  }
  if (date.getTime() > now + 366 * 24 * 3600 * 1000) {
    return { error: 'That date is more than a year away — double-check it.' }
  }
  return { date }
}

/** Read-only stylist-overlap pre-check (mirrors POST /api/bookings). */
async function hasConflict(facilityId: string, stylistId: string, start: Date, end: Date, excludeBookingId?: string) {
  const conflict = await db.query.bookings.findFirst({
    where: and(
      eq(bookings.facilityId, facilityId),
      eq(bookings.stylistId, stylistId),
      eq(bookings.active, true),
      or(eq(bookings.status, 'scheduled'), eq(bookings.status, 'completed')),
      lt(bookings.startTime, end),
      gt(bookings.endTime, start),
      ...(excludeBookingId ? [ne(bookings.id, excludeBookingId)] : []),
    ),
    columns: { id: true, startTime: true },
  })
  return conflict ?? null
}

const expiry = () => new Date(Date.now() + 10 * 60_000).toISOString()

// ── P39 — open-slot math (pure, harness-tested) ────────────────────────────
// Windows are the stylist's weekly hours ('HH:MM' facility-local). Candidate
// starts step every 30min inside the window; each is converted to a real UTC
// instant via fromDateTimeLocalInTz (DST-safe) and checked against busy
// intervals. NOTE: this deliberately does the window check in FACILITY time —
// resolveAvailableStylists' UTC-window quirk is not replicated here.

export interface SlotWindow {
  dayOfWeek: number // 0-6, Sun=0
  startTime: string // 'HH:MM'
  endTime: string // 'HH:MM'
}
export interface BusyInterval {
  start: number // UTC ms
  end: number // UTC ms
}

function addDaysToDateStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

const hmToMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

export function computeOpenSlots(opts: {
  windows: SlotWindow[]
  busy: BusyInterval[]
  offDates: Set<string> // facility-local YYYY-MM-DD fully unavailable (time off)
  startDate: string // facility-local YYYY-MM-DD
  days: number
  tz: string
  durationMinutes: number
  now: number // UTC ms — slots in the past are dropped
  limit?: number
}): Array<{ dateTimeLocal: string; startUtcMs: number }> {
  const out: Array<{ dateTimeLocal: string; startUtcMs: number }> = []
  const limit = opts.limit ?? 8
  const durMs = opts.durationMinutes * 60_000
  for (let d = 0; d < opts.days && out.length < limit; d++) {
    const dateStr = addDaysToDateStr(opts.startDate, d)
    if (opts.offDates.has(dateStr)) continue
    // A calendar date's weekday is tz-independent for the date LABEL.
    const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay()
    const win = opts.windows.find((w) => w.dayOfWeek === dow)
    if (!win) continue
    const startMin = hmToMin(win.startTime)
    const endMin = hmToMin(win.endTime)
    for (let m = startMin; m + opts.durationMinutes <= endMin && out.length < limit; m += 30) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0')
      const mm = String(m % 60).padStart(2, '0')
      const local = `${dateStr}T${hh}:${mm}`
      const start = fromDateTimeLocalInTz(local, opts.tz).getTime()
      if (Number.isNaN(start) || start <= opts.now) continue
      const end = start + durMs
      const clash = opts.busy.some((b) => b.start < end && b.end > start)
      if (clash) continue
      out.push({ dateTimeLocal: local, startUtcMs: start })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// READ TOOLS
// ---------------------------------------------------------------------------

const getSchedule: AssistantTool = {
  name: 'get_schedule',
  description:
    'List appointments for a calendar date (optionally a few days). Returns bookingId per row — use those ids for cancel/reschedule. Stylists see only their own appointments.',
  parameters: {
    type: 'OBJECT',
    properties: {
      date: { type: 'STRING', description: 'Calendar date YYYY-MM-DD in the facility timezone.' },
      days: { type: 'INTEGER', description: 'How many days starting at date (1-7). Default 1.' },
      residentName: { type: 'STRING', description: 'Optional: only rows for this resident (fuzzy match).' },
    },
    required: ['date'],
  },
  kind: 'read',
  roles: ['admin', 'facility_staff', 'bookkeeper', 'stylist', 'master'],
  needsFacility: true,
  async execute(ctx, args) {
    const date = typeof args.date === 'string' ? args.date : ''
    if (!DATE_RE.test(date)) return err('date must be YYYY-MM-DD.')
    const days = Math.min(Math.max(Number(args.days ?? 1) || 1, 1), 7)
    const start = dayRangeInTimezone(date, ctx.timezone)
    if (!start) return err('That date is not valid.')
    const end = dayRangeInTimezone(date, ctx.timezone, days - 1)
    const windowEnd = end?.end ?? start.end

    const rows = await db.query.bookings.findMany({
      where: and(
        eq(bookings.facilityId, ctx.facilityId!),
        eq(bookings.active, true),
        eq(bookings.isDemo, false),
        gt(bookings.endTime, start.start),
        lt(bookings.startTime, windowEnd),
        ...(ctx.role === 'stylist' ? [eq(bookings.stylistId, ctx.stylistId!)] : []),
      ),
      columns: { id: true, startTime: true, status: true, paymentStatus: true, priceCents: true, rawServiceName: true },
      with: {
        resident: { columns: { name: true, roomNumber: true } },
        service: { columns: { name: true, priceCents: true } },
        stylist: { columns: { name: true } },
      },
      orderBy: (t, { asc }) => [asc(t.startTime)],
      limit: 100,
    })

    let shaped = rows.map((b) => ({
      bookingId: b.id,
      when: whenLabel(b.startTime, ctx.timezone),
      resident: b.resident?.name ?? 'Unknown',
      room: b.resident?.roomNumber ?? null,
      service: b.service?.name ?? b.rawServiceName ?? 'Unknown service',
      stylist: b.stylist?.name ?? null,
      status: b.status,
      paymentStatus: b.paymentStatus,
    }))
    const residentName = typeof args.residentName === 'string' ? args.residentName.trim() : ''
    if (residentName) {
      shaped = shaped.filter((r) => fuzzyScore(r.resident, residentName) >= 0.5)
    }
    return { response: { date, days, timezone: ctx.timezone, rows: shaped } }
  },
}

const findResident: AssistantTool = {
  name: 'find_resident',
  description:
    'Look up a PERSON living at this facility by (partial) name. Returns the closest matches with room number and, depending on your access, contact and balance info. Never call this with a facility code like F177 — those are facilities, not residents.',
  parameters: {
    type: 'OBJECT',
    properties: { name: { type: 'STRING', description: "Resident's name as the user said it." } },
    required: ['name'],
  },
  kind: 'read',
  roles: ['admin', 'facility_staff', 'bookkeeper', 'stylist', 'master'],
  needsFacility: true,
  async execute(ctx, args) {
    const name = typeof args.name === 'string' ? args.name.trim() : ''
    if (name.length < 2) return err('Give at least 2 characters of the name.')
    const roster = await db.query.residents.findMany({
      where: and(eq(residents.facilityId, ctx.facilityId!), eq(residents.active, true), eq(residents.isDemo, false)),
      columns: { id: true, name: true, roomNumber: true, poaName: true, poaPhone: true, qbOutstandingBalanceCents: true },
    })
    const { scored, ambiguous } = rankByName(roster, name)
    if (scored.length === 0) return err(`No resident matching "${name}" at ${ctx.facilityName ?? 'this facility'}.`)

    // Care preferences (P36) — best-effort, shown to every caregiving role.
    const ids = scored.map((x) => x.item.id)
    let prefsById = new Map<string, { styleNotes: string | null; allergyNotes: string | null }>()
    try {
      const prefs = await db.query.residentPreferences.findMany({
        where: inArray(residentPreferences.residentId, ids),
        columns: { residentId: true, styleNotes: true, allergyNotes: true },
      })
      prefsById = new Map(prefs.map((p) => [p.residentId, { styleNotes: p.styleNotes, allergyNotes: p.allergyNotes }]))
    } catch { /* pre-migration */ }

    // P40 enrichment — last completed visit + 90-day no-shows (one grouped
    // query) and, for billing roles, LIVE owed from open invoices (the
    // denormalized column goes stale — see buildFacilityDataPack).
    const billingRole = ctx.role === 'admin' || ctx.role === 'bookkeeper' || ctx.role === 'master'
    const activity = new Map<string, { lastVisit: string | null; noShows90d: number }>()
    const owedById = new Map<string, number>()
    try {
      const rows = (await db.execute(sql`
        SELECT b.resident_id::text AS rid,
          MAX(b.start_time) FILTER (WHERE b.status = 'completed') AS last_visit,
          COUNT(*) FILTER (WHERE b.status = 'no_show' AND b.start_time >= NOW() - interval '90 days') AS no_shows
        FROM bookings b
        WHERE b.resident_id = ANY(${ids}::uuid[]) AND b.active = true AND b.is_demo = false
        GROUP BY b.resident_id
      `)) as unknown as Array<Record<string, unknown>>
      for (const r of rows) {
        activity.set(String(r.rid), {
          lastVisit: r.last_visit ? formatDateInTz(new Date(String(r.last_visit)), ctx.timezone, { month: 'short', day: 'numeric', year: 'numeric' }) : null,
          noShows90d: Number(r.no_shows ?? 0),
        })
      }
      if (billingRole) {
        const owedRows = (await db.execute(sql`
          SELECT resident_id::text AS rid, COALESCE(SUM(open_balance_cents), 0)::bigint AS owed
          FROM qb_invoices
          WHERE resident_id = ANY(${ids}::uuid[]) AND is_demo = false AND open_balance_cents > 0
          GROUP BY resident_id
        `)) as unknown as Array<Record<string, unknown>>
        for (const r of owedRows) owedById.set(String(r.rid), Number(r.owed ?? 0))
      }
    } catch { /* enrichment is best-effort */ }

    const poaRole = ctx.role === 'admin' || ctx.role === 'facility_staff' || ctx.role === 'master'
    const matches = scored.map(({ item, score }) => ({
      residentId: item.id,
      name: item.name,
      room: item.roomNumber ?? null,
      matchScore: Math.round(score * 100) / 100,
      styleNotes: prefsById.get(item.id)?.styleNotes?.slice(0, 200) ?? null,
      allergyNotes: prefsById.get(item.id)?.allergyNotes?.slice(0, 200) ?? null,
      lastCompletedVisit: activity.get(item.id)?.lastVisit ?? null,
      noShowsLast90Days: activity.get(item.id)?.noShows90d ?? 0,
      // POA contact stays hidden from stylists (P30 peek rule).
      ...(poaRole ? { poaName: item.poaName ?? null, poaPhone: item.poaPhone ?? null } : {}),
      ...(billingRole ? { owed: money(owedById.get(item.id) ?? 0) } : {}),
    }))
    return { response: { matches, ambiguous } }
  },
}

const listServices: AssistantTool = {
  name: 'list_services',
  description: 'List the service catalog for this facility with prices and durations.',
  parameters: { type: 'OBJECT', properties: {} },
  kind: 'read',
  roles: ['admin', 'facility_staff', 'bookkeeper', 'stylist', 'master'],
  needsFacility: true,
  async execute(ctx) {
    const rows = await db.query.services.findMany({
      where: and(
        eq(services.facilityId, ctx.facilityId!),
        eq(services.active, true),
        eq(services.isDemo, false),
        eq(services.source, 'price_list'),
      ),
      columns: { name: true, priceCents: true, durationMinutes: true, pricingType: true, category: true },
      orderBy: (t, { asc }) => [asc(t.name)],
      limit: 120,
    })
    return {
      response: {
        services: rows.map((r) => ({
          name: r.name,
          price: r.pricingType === 'fixed' ? money(r.priceCents) : `${r.pricingType} pricing`,
          durationMinutes: r.durationMinutes,
          category: r.category ?? null,
        })),
      },
    }
  },
}

/** Trim the analyst pack at the tool edge (it replays every loop round). */
function trimPack(pack: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...pack }
  delete copy.familyCarePreferences
  if (Array.isArray(copy.byServiceLast90Days)) copy.byServiceLast90Days = copy.byServiceLast90Days.slice(0, 10)
  if (Array.isArray(copy.byStylistLast90Days)) copy.byStylistLast90Days = copy.byStylistLast90Days.slice(0, 10)
  return copy
}

const getBusinessNumbers: AssistantTool = {
  name: 'get_business_numbers',
  description:
    'THE money tool: revenue, visit counts, what is owed (open balances — including which residents owe the most), aging, collections, and per-service/per-stylist breakdowns for the currently selected facility. Use for any "how much / owed / revenue / numbers" question. For the master admin with no facility selected it covers the whole network.',
  parameters: { type: 'OBJECT', properties: {} },
  kind: 'read',
  roles: ['admin', 'bookkeeper', 'master'],
  needsFacility: false,
  async execute(ctx) {
    const pack = ctx.facilityId ? await buildFacilityDataPack(ctx.facilityId) : await buildMasterDataPack()
    return { response: trimPack(pack) }
  },
}

const getFacilityNumbers: AssistantTool = {
  name: 'get_facility_numbers',
  description: 'Master admin: business numbers for ONE named facility (name or F-code).',
  parameters: {
    type: 'OBJECT',
    properties: { nameOrCode: { type: 'STRING', description: 'Facility name or F-code like F177.' } },
    required: ['nameOrCode'],
  },
  kind: 'read',
  roles: ['master'],
  needsFacility: false,
  async execute(_ctx, args) {
    const q = typeof args.nameOrCode === 'string' ? args.nameOrCode.trim() : ''
    if (!q) return err('Give a facility name or F-code.')
    const all = await db.query.facilities.findMany({
      where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
      columns: { id: true, name: true, facilityCode: true },
    })
    const byCode = all.find((f) => (f.facilityCode ?? '').toLowerCase() === q.toLowerCase())
    const target = byCode ?? (() => {
      const { scored } = rankByName(all, q)
      return scored[0] && scored[0].score >= 0.6 ? scored[0].item : null
    })()
    if (!target) return err(`No facility matching "${q}".`)
    return { response: trimPack(await buildFacilityDataPack(target.id)) }
  },
}

const getMyEarnings: AssistantTool = {
  name: 'get_my_earnings',
  description: "The stylist's own completed visits, revenue, and estimated commission for a month.",
  parameters: {
    type: 'OBJECT',
    properties: { month: { type: 'STRING', description: 'YYYY-MM. Default: the current month.' } },
  },
  kind: 'read',
  roles: ['stylist'],
  needsFacility: true,
  async execute(ctx, args) {
    if (!ctx.stylistId) return err("Your account isn't linked to a stylist profile yet — ask your admin to link you in Settings → Team.")
    const p = getLocalParts(new Date(), ctx.timezone)
    const monthArg = typeof args.month === 'string' && /^\d{4}-\d{2}$/.test(args.month)
      ? args.month
      : `${p.year}-${String(p.month).padStart(2, '0')}`
    const [y, m] = monthArg.split('-').map(Number)
    const start = dayRangeInTimezone(`${y}-${String(m).padStart(2, '0')}-01`, ctx.timezone)!.start
    const nextY = m === 12 ? y + 1 : y
    const nextM = m === 12 ? 1 : m + 1
    const end = dayRangeInTimezone(`${nextY}-${String(nextM).padStart(2, '0')}-01`, ctx.timezone)!.start

    const rows = await db.execute(sql`
      SELECT COUNT(*) AS visits,
        COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0) + COALESCE(b.addon_total_cents, 0)), 0)::bigint AS revenue_cents,
        COALESCE(SUM(b.tip_cents), 0)::bigint AS tips_cents
      FROM bookings b LEFT JOIN services s ON s.id = b.service_id
      WHERE b.stylist_id = ${ctx.stylistId} AND b.facility_id = ${ctx.facilityId}
        AND b.active = true AND b.is_demo = false AND b.status = 'completed'
        AND b.start_time >= ${start.toISOString()}::timestamptz AND b.start_time < ${end.toISOString()}::timestamptz
    `)
    const r = (rows as unknown as Array<Record<string, unknown>>)[0] ?? {}
    const stylist = await db.query.stylists.findFirst({
      where: eq(stylists.id, ctx.stylistId),
      columns: { commissionPercent: true },
    })
    const assignment = await db.query.stylistFacilityAssignments.findFirst({
      where: and(
        eq(stylistFacilityAssignments.stylistId, ctx.stylistId),
        eq(stylistFacilityAssignments.facilityId, ctx.facilityId!),
        eq(stylistFacilityAssignments.active, true),
      ),
      columns: { commissionPercent: true },
    })
    const pct = resolveCommission(stylist?.commissionPercent ?? 0, assignment)
    const revenueCents = Number(r.revenue_cents ?? 0)
    return {
      response: {
        month: monthArg,
        completedVisits: Number(r.visits ?? 0),
        revenue: money(revenueCents),
        commissionPercent: pct,
        estimatedCommission: money(Math.round((revenueCents * pct) / 100)),
        tips: money(Number(r.tips_cents ?? 0)),
        note: 'Completed visits only. Estimated — the payroll page is the authority.',
      },
    }
  },
}

const findOpenSlots: AssistantTool = {
  name: 'find_open_slots',
  description:
    "Find a stylist's next OPEN appointment slots from their real working hours, existing bookings, and time off. Use this for 'next available slot' / 'fit her in' requests, then propose the chosen slot with book_appointment (its dateTimeLocal feeds straight in).",
  parameters: {
    type: 'OBJECT',
    properties: {
      date: { type: 'STRING', description: 'Start the search at this facility-local date, YYYY-MM-DD. Default: today.' },
      days: { type: 'INTEGER', description: 'How many days to scan (1-14). Default 7.' },
      serviceName: { type: 'STRING', description: 'Service being booked — its duration sizes the slot. Optional (default 30 min).' },
      stylistName: { type: 'STRING', description: "Whose schedule to search. Omit for the current stylist (stylists always search their own)." },
    },
  },
  kind: 'read',
  roles: ['admin', 'facility_staff', 'bookkeeper', 'stylist', 'master'],
  needsFacility: true,
  async execute(ctx, args) {
    // Whose schedule?
    let stylistId: string
    let stylistLabel: string
    const namedStylist = typeof args.stylistName === 'string' ? args.stylistName.trim() : ''
    if (ctx.role === 'stylist') {
      if (!ctx.stylistId) {
        return err("Your account isn't linked to a stylist profile yet — ask your admin to link you in Settings → Team.")
      }
      stylistId = ctx.stylistId
      stylistLabel = 'you'
    } else {
      const roster = await facilityRoster(ctx.facilityId!)
      if (namedStylist) {
        const st = rankByName(roster, namedStylist)
        if (st.scored.length === 0 || st.scored[0].score < 0.6) {
          return err(`No stylist matching "${namedStylist}" here.`, { stylists: roster.map((s) => s.name) })
        }
        stylistId = st.scored[0].item.id
        stylistLabel = st.scored[0].item.name
      } else if (roster.length === 1) {
        stylistId = roster[0].id
        stylistLabel = roster[0].name
      } else {
        return err('Which stylist? Ask the user to pick one.', { stylists: roster.map((s) => s.name) })
      }
    }

    // Slot duration from the service, when named.
    let durationMinutes = 30
    const serviceName = typeof args.serviceName === 'string' ? args.serviceName.trim() : ''
    if (serviceName) {
      const catalog = await db.query.services.findMany({
        where: and(
          eq(services.facilityId, ctx.facilityId!),
          eq(services.active, true),
          eq(services.isDemo, false),
          eq(services.source, 'price_list'),
        ),
        columns: { id: true, name: true, durationMinutes: true },
      })
      const svc = rankByName(catalog, serviceName)
      if (svc.scored[0] && svc.scored[0].score >= 0.55) {
        durationMinutes = svc.scored[0].item.durationMinutes || 30
      }
    }

    const startDate =
      typeof args.date === 'string' && DATE_RE.test(args.date)
        ? args.date
        : (() => {
            const p = getLocalParts(new Date(), ctx.timezone)
            return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
          })()
    const days = Math.min(Math.max(Number(args.days ?? 7) || 7, 1), 14)
    const endDateStr = addDaysToDateStr(startDate, days - 1)

    // Working hours for this facility (facility-local windows).
    const windows = await db.query.stylistAvailability.findMany({
      where: and(
        eq(stylistAvailability.stylistId, stylistId),
        eq(stylistAvailability.facilityId, ctx.facilityId!),
        eq(stylistAvailability.active, true),
      ),
      columns: { dayOfWeek: true, startTime: true, endTime: true },
    })
    if (windows.length === 0) {
      return err(
        `${stylistLabel === 'you' ? 'You have' : `${stylistLabel} has`} no working hours set at ${ctx.facilityName ?? 'this facility'} — an admin can set them on the stylist's page.`,
      )
    }

    // Busy intervals: this stylist's real bookings over the whole range.
    const rangeStart = dayRangeInTimezone(startDate, ctx.timezone)!.start
    const rangeEnd = dayRangeInTimezone(endDateStr, ctx.timezone)!.end
    const busyRows = await db.query.bookings.findMany({
      where: and(
        eq(bookings.stylistId, stylistId),
        eq(bookings.facilityId, ctx.facilityId!),
        eq(bookings.active, true),
        or(eq(bookings.status, 'scheduled'), eq(bookings.status, 'completed')),
        gt(bookings.endTime, rangeStart),
        lt(bookings.startTime, rangeEnd),
      ),
      columns: { startTime: true, endTime: true },
      limit: 500,
    })

    // Approved time off (open/filled coverage) → whole days off.
    const offDates = new Set<string>()
    try {
      const coverage = await db.query.coverageRequests.findMany({
        where: and(
          eq(coverageRequests.stylistId, stylistId),
          inArray(coverageRequests.status, ['open', 'filled']),
          lte(coverageRequests.startDate, endDateStr),
          gte(coverageRequests.endDate, startDate),
        ),
        columns: { startDate: true, endDate: true },
      })
      for (const c of coverage) {
        let d = c.startDate < startDate ? startDate : c.startDate
        const last = c.endDate > endDateStr ? endDateStr : c.endDate
        while (d <= last) {
          offDates.add(d)
          d = addDaysToDateStr(d, 1)
        }
      }
    } catch { /* coverage table issues never block slot search */ }

    const slots = computeOpenSlots({
      windows,
      busy: busyRows.map((b) => ({ start: b.startTime.getTime(), end: b.endTime.getTime() })),
      offDates,
      startDate,
      days,
      tz: ctx.timezone,
      durationMinutes,
      now: Date.now(),
      limit: 8,
    })

    if (slots.length === 0) {
      return err(
        `No open ${durationMinutes}-minute slots for ${stylistLabel} between ${startDate} and ${endDateStr} — try more days or a different stylist.`,
      )
    }
    return {
      response: {
        stylist: stylistLabel,
        durationMinutes,
        timezone: ctx.timezone,
        slots: slots.map((s) => ({
          dateTimeLocal: s.dateTimeLocal,
          label: whenLabel(new Date(s.startUtcMs), ctx.timezone),
        })),
        note: 'Offer the top 1-2 conversationally; pass the chosen dateTimeLocal to book_appointment.',
      },
    }
  },
}

const getResidentLedger: AssistantTool = {
  name: 'get_resident_ledger',
  description:
    "A resident's money picture: live balance, open invoices, available credits, and recent invoice/payment activity. Use for 'how much does X owe / what has X paid'.",
  parameters: {
    type: 'OBJECT',
    properties: { residentName: { type: 'STRING', description: "Resident's name." } },
    required: ['residentName'],
  },
  kind: 'read',
  roles: ['admin', 'bookkeeper', 'master'],
  needsFacility: true,
  async execute(ctx, args) {
    const name = typeof args.residentName === 'string' ? args.residentName.trim() : ''
    if (name.length < 2) return err('Which resident?')
    const roster = await db.query.residents.findMany({
      where: and(eq(residents.facilityId, ctx.facilityId!), eq(residents.active, true), eq(residents.isDemo, false)),
      columns: { id: true, name: true },
    })
    const ranked = rankByName(roster, name)
    if (!ranked.scored[0]) return err(`No resident matching "${name}".`)
    if (ranked.ambiguous) {
      return err('Multiple residents match — ask which one.', {
        candidates: ranked.scored.map((x) => x.item.name),
      })
    }
    const resident = ranked.scored[0].item

    const [invoices, payments, credits] = await Promise.all([
      db.query.qbInvoices.findMany({
        where: and(eq(qbInvoices.residentId, resident.id), eq(qbInvoices.isDemo, false)),
        columns: { invoiceNum: true, invoiceDate: true, amountCents: true, openBalanceCents: true, status: true },
        orderBy: (t, { desc }) => [desc(t.invoiceDate)],
        limit: 50,
      }),
      db.query.qbPayments.findMany({
        where: and(eq(qbPayments.residentId, resident.id), eq(qbPayments.isDemo, false)),
        columns: { paymentDate: true, amountCents: true, paymentMethod: true },
        orderBy: (t, { desc }) => [desc(t.paymentDate)],
        limit: 25,
      }),
      db.query.qbUnappliedCredits.findMany({
        where: eq(qbUnappliedCredits.residentId, resident.id),
        columns: { txnDate: true, amountCents: true, openBalanceCents: true, appliedCents: true },
        limit: 20,
      }).catch(() => []),
    ])

    const openInvoices = invoices.filter((i) => (i.openBalanceCents ?? 0) > 0)
    const owedCents = openInvoices.reduce((s, i) => s + (i.openBalanceCents ?? 0), 0)
    const creditCents = credits.reduce((s, c) => s + Math.max(0, (c.openBalanceCents ?? 0) - (c.appliedCents ?? 0)), 0)
    return {
      response: {
        resident: resident.name,
        owed: money(owedCents),
        availableCredit: money(creditCents),
        openInvoices: openInvoices.slice(0, 10).map((i) => ({
          num: i.invoiceNum, date: String(i.invoiceDate), open: money(i.openBalanceCents ?? 0), status: i.status,
        })),
        recentPayments: payments.slice(0, 6).map((p) => ({
          date: String(p.paymentDate), amount: money(p.amountCents ?? 0), method: p.paymentMethod ?? null,
        })),
        recentInvoices: invoices.slice(0, 6).map((i) => ({
          num: i.invoiceNum, date: String(i.invoiceDate), amount: money(i.amountCents ?? 0), open: money(i.openBalanceCents ?? 0),
        })),
      },
    }
  },
}

const getStylistInfo: AssistantTool = {
  name: 'get_stylist_info',
  description:
    "A stylist's full picture: weekly hours, upcoming time off (with request ids for decide_time_off), commission, status, compliance (license/insurance/background), and this month's completed visits + revenue. Stylists get their own info.",
  parameters: {
    type: 'OBJECT',
    properties: { stylistName: { type: 'STRING', description: 'Omit for yourself (stylists always get themselves).' } },
  },
  kind: 'read',
  roles: ['admin', 'stylist', 'master'],
  needsFacility: true,
  async execute(ctx, args) {
    let stylistId: string
    if (ctx.role === 'stylist') {
      if (!ctx.stylistId) return err("Your account isn't linked to a stylist profile yet.")
      stylistId = ctx.stylistId
    } else {
      const named = typeof args.stylistName === 'string' ? args.stylistName.trim() : ''
      const roster = await facilityRoster(ctx.facilityId!)
      if (!named) {
        if (roster.length === 1) stylistId = roster[0].id
        else return err('Which stylist?', { stylists: roster.map((s) => s.name) })
      } else {
        const ranked = rankByName(roster, named)
        if (!ranked.scored[0] || ranked.scored[0].score < 0.6) {
          return err(`No stylist matching "${named}".`, { stylists: roster.map((s) => s.name) })
        }
        stylistId = ranked.scored[0].item.id
      }
    }

    const p = getLocalParts(new Date(), ctx.timezone)
    const monthStart = dayRangeInTimezone(`${p.year}-${String(p.month).padStart(2, '0')}-01`, ctx.timezone)!.start
    const todayStr = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`

    const [stylist, windows, timeOff, assignment, mtdRows] = await Promise.all([
      db.query.stylists.findFirst({
        where: eq(stylists.id, stylistId),
        columns: {
          name: true, commissionPercent: true, status: true,
          licenseNumber: true, licenseExpiresAt: true, insuranceVerified: true,
          insuranceExpiresAt: true, backgroundCheckVerified: true,
        },
      }),
      db.query.stylistAvailability.findMany({
        where: and(
          eq(stylistAvailability.stylistId, stylistId),
          eq(stylistAvailability.facilityId, ctx.facilityId!),
          eq(stylistAvailability.active, true),
        ),
        columns: { dayOfWeek: true, startTime: true, endTime: true },
        orderBy: (t, { asc }) => [asc(t.dayOfWeek)],
      }),
      db.query.coverageRequests.findMany({
        where: and(
          eq(coverageRequests.stylistId, stylistId),
          inArray(coverageRequests.status, ['pending', 'open', 'filled']),
          gte(coverageRequests.endDate, todayStr),
        ),
        columns: { id: true, startDate: true, endDate: true, status: true, reason: true },
        limit: 10,
      }),
      db.query.stylistFacilityAssignments.findFirst({
        where: and(
          eq(stylistFacilityAssignments.stylistId, stylistId),
          eq(stylistFacilityAssignments.facilityId, ctx.facilityId!),
          eq(stylistFacilityAssignments.active, true),
        ),
        columns: { commissionPercent: true },
      }),
      db.execute(sql`
        SELECT COUNT(*) AS visits,
          COALESCE(SUM(COALESCE(b.price_cents, s.price_cents, 0)), 0)::bigint AS revenue_cents
        FROM bookings b LEFT JOIN services s ON s.id = b.service_id
        WHERE b.stylist_id = ${stylistId} AND b.facility_id = ${ctx.facilityId}
          AND b.active = true AND b.is_demo = false AND b.status = 'completed'
          AND b.start_time >= ${monthStart.toISOString()}::timestamptz
      `),
    ])
    if (!stylist) return err('Stylist not found.')
    const mtd = (mtdRows as unknown as Array<Record<string, unknown>>)[0] ?? {}
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return {
      response: {
        name: stylist.name,
        status: stylist.status,
        commissionPercent: resolveCommission(stylist.commissionPercent ?? 0, assignment),
        weeklyHours: windows.map((w) => `${DAYS[w.dayOfWeek]} ${w.startTime}-${w.endTime}`),
        upcomingTimeOff: timeOff.map((t) => ({
          requestId: t.id,
          dates: t.startDate === t.endDate ? t.startDate : `${t.startDate} – ${t.endDate}`,
          status: t.status === 'open' ? 'approved' : t.status,
          reason: t.reason ?? null,
        })),
        compliance: {
          licenseOnFile: !!stylist.licenseNumber,
          licenseExpires: stylist.licenseExpiresAt ? String(stylist.licenseExpiresAt) : null,
          insuranceVerified: stylist.insuranceVerified,
          insuranceExpires: stylist.insuranceExpiresAt ? String(stylist.insuranceExpiresAt) : null,
          backgroundCheckVerified: stylist.backgroundCheckVerified,
        },
        thisMonth: { completedVisits: Number(mtd.visits ?? 0), revenue: money(Number(mtd.revenue_cents ?? 0)) },
      },
    }
  },
}

const getTimeOffRequests: AssistantTool = {
  name: 'get_time_off_requests',
  description:
    "The facility's time-off requests with request ids (needed for decide_time_off). Default: pending + upcoming approved.",
  parameters: {
    type: 'OBJECT',
    properties: { status: { type: 'STRING', description: "Optional filter: 'pending', 'open' (approved), 'filled', 'denied'." } },
  },
  kind: 'read',
  roles: ['admin', 'master'],
  needsFacility: true,
  async execute(ctx, args) {
    const statusArg = typeof args.status === 'string' ? args.status.trim() : ''
    const statuses = ['pending', 'open', 'filled', 'denied'].includes(statusArg) ? [statusArg] : ['pending', 'open', 'filled']
    const rows = await db.query.coverageRequests.findMany({
      where: and(eq(coverageRequests.facilityId, ctx.facilityId!), inArray(coverageRequests.status, statuses)),
      with: { stylist: { columns: { name: true } }, substituteStylist: { columns: { name: true } } },
      orderBy: (t, { asc }) => [asc(t.startDate)],
      limit: 30,
    })
    return {
      response: {
        requests: rows.map((r) => ({
          requestId: r.id,
          stylist: r.stylist?.name ?? 'Unknown',
          dates: r.startDate === r.endDate ? r.startDate : `${r.startDate} – ${r.endDate}`,
          status: r.status === 'open' ? 'approved (needs substitute)' : r.status,
          substitute: r.substituteStylist?.name ?? null,
          reason: r.reason ?? null,
        })),
      },
    }
  },
}

const getWaitlist: AssistantTool = {
  name: 'get_waitlist',
  description: 'The pending cancellation waitlist — residents waiting for a freed slot.',
  parameters: { type: 'OBJECT', properties: {} },
  kind: 'read',
  roles: ['admin', 'facility_staff', 'bookkeeper', 'master'],
  needsFacility: true,
  async execute(ctx) {
    const rows = await db.query.waitlistEntries.findMany({
      where: and(
        eq(waitlistEntries.facilityId, ctx.facilityId!),
        eq(waitlistEntries.status, 'pending'),
        eq(waitlistEntries.isDemo, false),
      ),
      columns: { residentName: true, roomNumber: true, serviceName: true, earliestDate: true, latestDate: true, notes: true },
      orderBy: (t, { asc }) => [asc(t.earliestDate)],
      limit: 50,
    })
    return {
      response: {
        waitlist: rows.map((r) => ({
          resident: r.residentName,
          room: r.roomNumber ?? null,
          service: r.serviceName ?? null,
          window: r.latestDate ? `${r.earliestDate} – ${r.latestDate}` : `from ${r.earliestDate}`,
          notes: r.notes ?? null,
        })),
      },
    }
  },
}

const getSignupQueue: AssistantTool = {
  name: 'get_signup_queue',
  description: "Pending sign-up sheet requests (residents asking for an appointment, not yet scheduled). Stylists see their own + unassigned.",
  parameters: { type: 'OBJECT', properties: {} },
  kind: 'read',
  roles: ['admin', 'facility_staff', 'stylist', 'master'],
  needsFacility: true,
  async execute(ctx) {
    const rows = await db.query.signupSheetEntries.findMany({
      where: and(
        eq(signupSheetEntries.facilityId, ctx.facilityId!),
        eq(signupSheetEntries.status, 'pending'),
        eq(signupSheetEntries.isDemo, false),
        // Route parity: stylists see own + unassigned only.
        ...(ctx.role === 'stylist' && ctx.stylistId
          ? [or(eq(signupSheetEntries.assignedToStylistId, ctx.stylistId), sql`${signupSheetEntries.assignedToStylistId} IS NULL`)!]
          : []),
      ),
      with: { assignedStylist: { columns: { name: true } } },
      orderBy: (t, { asc }) => [asc(t.requestedDate)],
      limit: 50,
    })
    return {
      response: {
        pending: rows.map((r) => ({
          resident: r.residentName,
          room: r.roomNumber ?? null,
          service: r.serviceName,
          requested: r.requestedDate,
          preferredDate: r.preferredDate ?? null,
          assignedTo: r.assignedStylist?.name ?? null,
          notes: r.notes ?? null,
        })),
      },
    }
  },
}

const getPayrollSummary: AssistantTool = {
  name: 'get_payroll_summary',
  description:
    'Payroll pay periods with totals; pass a periodId for the per-stylist breakdown (commission, tips, net pay).',
  parameters: {
    type: 'OBJECT',
    properties: { periodId: { type: 'STRING', description: 'Optional pay-period id from the period list.' } },
  },
  kind: 'read',
  roles: ['admin', 'bookkeeper', 'master'],
  needsFacility: true,
  async execute(ctx, args) {
    const periodId = typeof args.periodId === 'string' && UUID_RE.test(args.periodId) ? args.periodId : null
    if (periodId) {
      const period = await db.query.payPeriods.findFirst({
        where: and(eq(payPeriods.id, periodId), eq(payPeriods.facilityId, ctx.facilityId!)),
        with: { items: { with: { stylist: { columns: { name: true } } } } },
      })
      if (!period) return err('Pay period not found at this facility.')
      return {
        response: {
          period: `${period.startDate} – ${period.endDate}`,
          status: period.status,
          stylists: (period.items ?? []).map((i) => ({
            stylist: i.stylist?.name ?? 'Unknown',
            revenue: money(i.grossRevenueCents ?? 0),
            commissionPercent: i.commissionRate,
            commission: money(i.commissionAmountCents ?? 0),
            tips: money(i.tipCentsTotal ?? 0),
            netPay: money(i.netPayCents ?? 0),
          })),
        },
      }
    }
    const periods = await db.query.payPeriods.findMany({
      where: eq(payPeriods.facilityId, ctx.facilityId!),
      with: { items: { columns: { netPayCents: true } } },
      orderBy: (t, { desc }) => [desc(t.startDate)],
      limit: 6,
    })
    return {
      response: {
        periods: periods.map((pp) => ({
          periodId: pp.id,
          dates: `${pp.startDate} – ${pp.endDate}`,
          status: pp.status,
          stylists: (pp.items ?? []).length,
          totalPayout: money((pp.items ?? []).reduce((s, i) => s + (i.netPayCents ?? 0), 0)),
        })),
        note: 'Pass a periodId for the per-stylist breakdown.',
      },
    }
  },
}

const getFeedbackInbox: AssistantTool = {
  name: 'get_feedback_inbox',
  description: 'New (unreviewed) feedback submissions from staff, with ids for reply_to_feedback.',
  parameters: { type: 'OBJECT', properties: {} },
  kind: 'read',
  roles: ['master'],
  needsFacility: false,
  async execute() {
    const rows = await db.query.feedbackSubmissions.findMany({
      where: eq(feedbackSubmissions.status, 'new'),
      columns: { id: true, category: true, message: true, role: true, createdAt: true, userId: true },
      orderBy: (t, { desc }) => [desc(t.createdAt)],
      limit: 20,
    })
    const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))]
    const profileRows = userIds.length
      ? await db.query.profiles.findMany({
          where: (t, { inArray: ia }) => ia(t.id, userIds),
          columns: { id: true, fullName: true, email: true },
        })
      : []
    const nameById = new Map(profileRows.map((p) => [p.id, p.fullName ?? p.email ?? '—']))
    return {
      response: {
        newFeedback: rows.map((r) => ({
          feedbackId: r.id,
          from: r.userId ? nameById.get(r.userId) ?? '—' : '—',
          role: r.role ?? null,
          category: r.category,
          message: r.message.slice(0, 200),
        })),
      },
    }
  },
}

// ---------------------------------------------------------------------------
// WRITE TOOLS — propose only; the client executes after human confirmation.
// ---------------------------------------------------------------------------

const WRITE_ROLES: AssistantCtx['role'][] = ['admin', 'facility_staff', 'stylist', 'bookkeeper', 'master']

/** Stylist-role callers must have a linked stylist record (mirrors the POST 403). */
function stylistWriteGuard(ctx: AssistantCtx): string | null {
  if (ctx.role === 'stylist' && !ctx.stylistId) {
    return "Your account isn't linked to a stylist profile yet — ask your admin to link you in Settings → Team."
  }
  return null
}

const bookAppointment: AssistantTool = {
  name: 'book_appointment',
  description:
    'Propose a NEW appointment. Nothing is booked until the user taps Confirm on screen. Resolve the resident and service names first if unsure (find_resident / list_services); for "next available" requests get the time from find_open_slots.',
  parameters: {
    type: 'OBJECT',
    properties: {
      residentName: { type: 'STRING', description: "Resident's name as the user said it." },
      serviceName: { type: 'STRING', description: 'Service name as the user said it.' },
      dateTimeLocal: {
        type: 'STRING',
        description: 'Facility-local wall-clock start time, format YYYY-MM-DDTHH:mm. Resolve relative phrases ("tomorrow at 10") against the current facility date/time given in the instructions. Do NOT convert timezones.',
      },
      stylistName: { type: 'STRING', description: 'Only if the user named a specific stylist.' },
      notes: { type: 'STRING', description: 'Optional short note for the appointment.' },
      createNewResident: {
        type: 'BOOLEAN',
        description: 'Set true ONLY after the user explicitly said this is a NEW resident (not a misspelling of an existing one). The resident is created together with the booking.',
      },
      roomNumber: { type: 'STRING', description: 'Room number for a NEW resident, if the user gave one.' },
    },
    required: ['residentName', 'serviceName', 'dateTimeLocal'],
  },
  kind: 'write',
  roles: WRITE_ROLES,
  needsFacility: true,
  async execute(ctx, args) {
    const guard = stylistWriteGuard(ctx)
    if (guard) return err(guard)

    // Resident — three paths (P38c, from Josh's "Adeel kohen" report):
    // (1) strong match → use it; (2) near-miss → did-you-mean error so the
    // model asks "did you mean X, or is this a new resident?"; (3) the user
    // confirmed NEW → book with the atomic newResident branch (same server
    // path as the walk-in form: created with the booking, name+room deduped).
    const residentName = typeof args.residentName === 'string' ? args.residentName.trim() : ''
    if (residentName.length < 2) return err('Which resident is this for?')
    const roster = await db.query.residents.findMany({
      where: and(eq(residents.facilityId, ctx.facilityId!), eq(residents.active, true), eq(residents.isDemo, false)),
      columns: { id: true, name: true, roomNumber: true },
    })
    const res = rankByName(roster, residentName)
    const createNew = args.createNewResident === true
    let resident: { id: string; name: string; roomNumber: string | null } | null = null
    if (createNew) {
      // Guard against duplicating a near-identical existing resident.
      if (res.scored[0] && res.scored[0].score >= 0.9) {
        return err(
          `A resident named "${res.scored[0].item.name}" already exists here — confirm with the user whether that's the same person before creating a new record.`,
          { existing: res.scored.slice(0, 3).map((x) => ({ name: x.item.name, room: x.item.roomNumber ?? null })) },
        )
      }
    } else if (res.scored[0] && res.scored[0].score >= 0.75 && !res.ambiguous) {
      resident = res.scored[0].item
    } else if (res.scored.length > 0) {
      return err(
        res.ambiguous
          ? 'Multiple residents are close to that name — ask the user which one they mean, or whether this is a brand-new resident.'
          : `No exact match for "${residentName}". Ask the user: did they mean one of the close matches below, or is this a NEW resident (then call book_appointment again with createNewResident: true)?`,
        { didYouMean: res.scored.slice(0, 3).map((x) => ({ name: x.item.name, room: x.item.roomNumber ?? null })) },
      )
    } else {
      return err(
        `No resident named "${residentName}" here. Ask the user whether this is a NEW resident — if yes, call book_appointment again with createNewResident: true (and roomNumber if they give one).`,
      )
    }

    // Service (price_list catalog; simple pricing only — tiered/multi_option
    // needs quantity/option inputs the chat can't collect reliably).
    const serviceName = typeof args.serviceName === 'string' ? args.serviceName.trim() : ''
    if (!serviceName) return err('Which service?')
    const catalog = await db.query.services.findMany({
      where: and(
        eq(services.facilityId, ctx.facilityId!),
        eq(services.active, true),
        eq(services.isDemo, false),
        eq(services.source, 'price_list'),
      ),
      columns: { id: true, name: true, priceCents: true, durationMinutes: true, pricingType: true },
    })
    const svc = rankByName(catalog, serviceName)
    if (svc.scored.length === 0 || svc.scored[0].score < 0.55) {
      return err(`No service matching "${serviceName}" in the catalog.`, {
        catalog: catalog.slice(0, 30).map((c) => c.name),
      })
    }
    const service = svc.scored[0].item
    if (service.pricingType === 'tiered' || service.pricingType === 'multi_option') {
      return err(`"${service.name}" has quantity/option pricing — it has to be booked from the booking form, not the assistant.`)
    }

    // Time
    const parsed = parseLocalDateTime(args.dateTimeLocal, ctx.timezone)
    if ('error' in parsed) return err(parsed.error)
    const start = parsed.date
    const endTime = new Date(start.getTime() + (service.durationMinutes || 30) * 60_000)

    // Stylist: stylist role → always self; a named stylist → roster fuzzy;
    // otherwise omitted so the endpoint auto-assigns (P36 preference logic).
    let stylistId: string | undefined
    let stylistLabel = 'best available (auto-assigned)'
    const namedStylist = typeof args.stylistName === 'string' ? args.stylistName.trim() : ''
    if (ctx.role === 'stylist') {
      if (namedStylist && ctx.stylistName && fuzzyScore(ctx.stylistName, namedStylist) < 0.6) {
        return err('Stylists can only book appointments for themselves.')
      }
      stylistId = ctx.stylistId!
      stylistLabel = 'you'
    } else if (namedStylist) {
      const rosterStylists = await facilityRoster(ctx.facilityId!)
      const st = rankByName(rosterStylists, namedStylist)
      if (st.scored.length === 0 || st.scored[0].score < 0.6) {
        return err(`No stylist matching "${namedStylist}" at this facility.`, {
          stylists: rosterStylists.map((s) => s.name),
        })
      }
      stylistId = st.scored[0].item.id
      stylistLabel = st.scored[0].item.name
    }

    // Conflict pre-check so the model can offer another time BEFORE confirm.
    if (stylistId) {
      const conflict = await hasConflict(ctx.facilityId!, stylistId, start, endTime)
      if (conflict) {
        return err(`${stylistLabel === 'you' ? 'You already have' : `${stylistLabel} already has`} an appointment at ${whenLabel(conflict.startTime, ctx.timezone)} — suggest a different time.`)
      }
    }

    const notes = typeof args.notes === 'string' ? args.notes.trim().slice(0, 500) : ''
    const newRoom = typeof args.roomNumber === 'string' ? args.roomNumber.trim().slice(0, 50) : ''
    const residentLabel = resident
      ? `${resident.name}${resident.roomNumber ? ` (Room ${resident.roomNumber})` : ''}`
      : `${residentName}${newRoom ? ` (Room ${newRoom})` : ''} — NEW resident, will be added`
    return {
      response: {
        proposed: true,
        summary: `${resident ? resident.name : `${residentName} (new resident)`} — ${service.name} — ${whenLabel(start, ctx.timezone)} — ${stylistLabel}`,
        instruction: 'Tell the user to review and tap Confirm below. Do not claim it is booked.',
      },
      pendingAction: {
        kind: 'book',
        summary: {
          title: resident ? 'Book appointment?' : 'Add new resident & book?',
          lines: [
            residentLabel,
            `${service.name} · ${service.pricingType === 'fixed' ? money(service.priceCents) : 'price varies'}`,
            whenLabel(start, ctx.timezone),
            `Stylist: ${stylistLabel}`,
            ...(notes ? [`Note: ${notes}`] : []),
          ],
        },
        request: {
          method: 'POST',
          path: '/api/bookings',
          // Exactly one of residentId | newResident (the POST schema's rule).
          // newResident rides the same atomic create+dedup branch the walk-in
          // form uses — the server soft-dedups on normalized name+room.
          body: {
            ...(resident
              ? { residentId: resident.id }
              : { newResident: { name: residentName, ...(newRoom ? { roomNumber: newRoom } : {}) } }),
            serviceId: service.id,
            startTime: start.toISOString(),
            ...(stylistId ? { stylistId } : {}),
            ...(notes ? { notes } : {}),
          },
        },
        expiresAt: expiry(),
      },
    }
  },
}

/** Shared cancel/reschedule target lookup with ownership + status validation. */
async function loadActionableBooking(ctx: AssistantCtx, rawId: unknown) {
  const id = typeof rawId === 'string' ? rawId : ''
  if (!UUID_RE.test(id)) return { error: 'bookingId must come from get_schedule.' } as const
  const booking = await db.query.bookings.findFirst({
    where: and(eq(bookings.id, id), eq(bookings.facilityId, ctx.facilityId!), eq(bookings.active, true)),
    columns: { id: true, startTime: true, status: true, stylistId: true, serviceId: true, rawServiceName: true },
    with: {
      resident: { columns: { name: true } },
      service: { columns: { name: true, durationMinutes: true } },
      stylist: { columns: { name: true } },
    },
  })
  if (!booking) return { error: 'That appointment was not found at this facility.' } as const
  if (booking.status !== 'scheduled') {
    return { error: `That appointment is ${booking.status} — only scheduled appointments can be changed.` } as const
  }
  if (ctx.role === 'stylist' && booking.stylistId !== ctx.stylistId) {
    return { error: 'Stylists can only change their own appointments.' } as const
  }
  return { booking } as const
}

const cancelAppointment: AssistantTool = {
  name: 'cancel_appointment',
  description:
    'Propose cancelling a scheduled appointment (get the bookingId from get_schedule first). Nothing is cancelled until the user taps Confirm.',
  parameters: {
    type: 'OBJECT',
    properties: { bookingId: { type: 'STRING', description: 'The bookingId from get_schedule.' } },
    required: ['bookingId'],
  },
  kind: 'write',
  roles: WRITE_ROLES,
  needsFacility: true,
  async execute(ctx, args) {
    const guard = stylistWriteGuard(ctx)
    if (guard) return err(guard)
    const loaded = await loadActionableBooking(ctx, args.bookingId)
    if ('error' in loaded && loaded.error) return err(loaded.error)
    const b = loaded.booking
    const label = `${b.resident?.name ?? 'Unknown'} — ${b.service?.name ?? b.rawServiceName ?? 'service'} — ${whenLabel(b.startTime, ctx.timezone)}`
    return {
      response: {
        proposed: true,
        summary: `Cancel: ${label}`,
        instruction: 'Tell the user to review and tap Confirm below. Do not claim it is cancelled.',
      },
      pendingAction: {
        kind: 'cancel',
        summary: {
          title: 'Cancel appointment?',
          lines: [label, ...(b.stylist?.name ? [`Stylist: ${b.stylist.name}`] : [])],
        },
        request: { method: 'DELETE', path: `/api/bookings/${b.id}`, body: null },
        expiresAt: expiry(),
      },
    }
  },
}

const rescheduleAppointment: AssistantTool = {
  name: 'reschedule_appointment',
  description:
    'Propose moving a scheduled appointment to a new time (get the bookingId from get_schedule first). Nothing changes until the user taps Confirm.',
  parameters: {
    type: 'OBJECT',
    properties: {
      bookingId: { type: 'STRING', description: 'The bookingId from get_schedule.' },
      newDateTimeLocal: { type: 'STRING', description: 'New facility-local start time, YYYY-MM-DDTHH:mm.' },
    },
    required: ['bookingId', 'newDateTimeLocal'],
  },
  kind: 'write',
  roles: WRITE_ROLES,
  needsFacility: true,
  async execute(ctx, args) {
    const guard = stylistWriteGuard(ctx)
    if (guard) return err(guard)
    const loaded = await loadActionableBooking(ctx, args.bookingId)
    if ('error' in loaded && loaded.error) return err(loaded.error)
    const b = loaded.booking
    const parsed = parseLocalDateTime(args.newDateTimeLocal, ctx.timezone)
    if ('error' in parsed) return err(parsed.error)
    const start = parsed.date
    const end = new Date(start.getTime() + (b.service?.durationMinutes || 30) * 60_000)
    if (b.stylistId) {
      const conflict = await hasConflict(ctx.facilityId!, b.stylistId, start, end, b.id)
      if (conflict) {
        return err(`${b.stylist?.name ?? 'The stylist'} already has an appointment at ${whenLabel(conflict.startTime, ctx.timezone)} — suggest a different time.`)
      }
    }
    const label = `${b.resident?.name ?? 'Unknown'} — ${b.service?.name ?? b.rawServiceName ?? 'service'}`
    return {
      response: {
        proposed: true,
        summary: `Move ${label} from ${whenLabel(b.startTime, ctx.timezone)} to ${whenLabel(start, ctx.timezone)}`,
        instruction: 'Tell the user to review and tap Confirm below. Do not claim it is moved.',
      },
      pendingAction: {
        kind: 'reschedule',
        summary: {
          title: 'Move appointment?',
          lines: [label, `From: ${whenLabel(b.startTime, ctx.timezone)}`, `To: ${whenLabel(start, ctx.timezone)}`],
        },
        // Body is EXACTLY { startTime } — the PUT accepts priceCents overrides,
        // so model-influenced bodies are forbidden by construction.
        request: { method: 'PUT', path: `/api/bookings/${b.id}`, body: { startTime: start.toISOString() } },
        expiresAt: expiry(),
      },
    }
  },
}

// ---------------------------------------------------------------------------

export const ALL_TOOLS: AssistantTool[] = [
  getSchedule,
  findResident,
  listServices,
  findOpenSlots,
  getBusinessNumbers,
  getFacilityNumbers,
  getMyEarnings,
  getResidentLedger,
  getStylistInfo,
  getTimeOffRequests,
  getWaitlist,
  getSignupQueue,
  getPayrollSummary,
  getFeedbackInbox,
  bookAppointment,
  cancelAppointment,
  rescheduleAppointment,
]

/** The tools this caller's model is allowed to see and call. */
export function toolsForCtx(ctx: AssistantCtx): AssistantTool[] {
  return ALL_TOOLS.filter((t) => {
    if (!t.roles.includes(ctx.role)) return false
    if (t.needsFacility && !ctx.facilityId) return false
    return true
  })
}

// Zod schema kept exported so the route/harness can sanity-check tool names.
export const toolNameSchema = z.enum([
  'get_schedule', 'find_resident', 'list_services', 'find_open_slots',
  'get_business_numbers', 'get_facility_numbers', 'get_my_earnings',
  'get_resident_ledger', 'get_stylist_info', 'get_time_off_requests',
  'get_waitlist', 'get_signup_queue', 'get_payroll_summary', 'get_feedback_inbox',
  'book_appointment', 'cancel_appointment', 'reschedule_appointment',
])
