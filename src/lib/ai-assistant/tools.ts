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
import { sql, and, eq, or, inArray, lt, gt, ne } from 'drizzle-orm'
import { z } from 'zod'
import {
  bookings, residents, services, stylists, stylistFacilityAssignments, facilities, residentPreferences,
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

export interface PendingAction {
  kind: 'book' | 'cancel' | 'reschedule'
  summary: {
    title: string
    lines: string[]
  }
  request: {
    method: 'POST' | 'PUT' | 'DELETE'
    path: string
    body: Record<string, unknown> | null
  }
  expiresAt: string
}

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

    const billingRole = ctx.role === 'admin' || ctx.role === 'bookkeeper' || ctx.role === 'master'
    const poaRole = ctx.role === 'admin' || ctx.role === 'facility_staff' || ctx.role === 'master'
    const matches = scored.map(({ item, score }) => ({
      residentId: item.id,
      name: item.name,
      room: item.roomNumber ?? null,
      matchScore: Math.round(score * 100) / 100,
      styleNotes: prefsById.get(item.id)?.styleNotes?.slice(0, 200) ?? null,
      allergyNotes: prefsById.get(item.id)?.allergyNotes?.slice(0, 200) ?? null,
      // POA contact stays hidden from stylists (P30 peek rule).
      ...(poaRole ? { poaName: item.poaName ?? null, poaPhone: item.poaPhone ?? null } : {}),
      ...(billingRole ? { owedCents: Number(item.qbOutstandingBalanceCents ?? 0) } : {}),
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
    'Propose a NEW appointment. Nothing is booked until the user taps Confirm on screen. Resolve the resident and service names first if unsure (find_resident / list_services).',
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
  getBusinessNumbers,
  getFacilityNumbers,
  getMyEarnings,
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
  'get_schedule', 'find_resident', 'list_services', 'get_business_numbers',
  'get_facility_numbers', 'get_my_earnings', 'book_appointment',
  'cancel_appointment', 'reschedule_appointment',
])
