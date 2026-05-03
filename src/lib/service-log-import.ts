/**
 * Service Log Import engine — Phase 12B.
 *
 * Pure functions for parsing bookkeeper XLSX service-log files and matching
 * the parsed rows against the existing facility/stylist/service/resident
 * catalog. Side-effect-ful work (DB writes) lives in the API route.
 */

import * as XLSX from 'xlsx'
import { fuzzyBestMatch, fuzzyScore, normalizeWords } from '@/lib/fuzzy'

export interface ParsedServiceLogRow {
  serviceDate: Date
  clientName: string
  room: string | null
  servicesPerformed: string
  amountCents: number
  notes: string | null
  tipsCents: number | null
  paymentType: string | null
}

export interface ParsedServiceLog {
  rows: ParsedServiceLogRow[]
  meta: { facility: string; stylist: string; stylistCode: string | null }
}

export interface ServiceCandidate {
  id: string
  name: string
  priceCents: number
  pricingType: string
  active: boolean
}

export type ServiceMatch =
  | { kind: 'name' | 'price' | 'combo'; serviceIds: string[]; needsReview: false }
  | { kind: 'unmatched'; serviceIds: []; needsReview: true }

const SKIP_CLIENT = new Set(["doesn't fill", 'doesnt fill', "doesn't fill in", ''])

// "ST624 - Senait Edwards" → { code: "ST624", name: "Senait Edwards" }
// "Senait Edwards"        → { code: null,    name: "Senait Edwards" }
export function splitStylistCell(raw: string): { stylistCode: string | null; stylistName: string } {
  const trimmed = raw.trim()
  const match = trimmed.match(/^([A-Z]{2,4}\d{2,5})\s*-\s*(.+)$/)
  if (match) return { stylistCode: match[1], stylistName: match[2].trim() }
  return { stylistCode: null, stylistName: trimmed }
}

function toCents(amount: unknown): number {
  if (typeof amount === 'number') return Math.round(amount * 100)
  if (typeof amount === 'string') {
    const cleaned = amount.replace(/[$,\s]/g, '')
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? Math.round(n * 100) : 0
  }
  return 0
}

// Excel serial date OR ISO string OR JS Date → JS Date in UTC
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'number') {
    // Excel epoch is 1899-12-30 UTC
    const epoch = Date.UTC(1899, 11, 30)
    return new Date(epoch + value * 86_400_000)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const d = new Date(trimmed)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

const SKIP_META = new Set(["doesn't fill", 'doesnt fill', "doesn't fill in"])

function mostFrequent(values: string[]): string {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best = ''
  let bestCount = 0
  for (const [v, c] of counts) {
    if (c > bestCount) { bestCount = c; best = v }
  }
  return best
}

export function parseServiceLogXlsx(buffer: Buffer, fileName?: string): ParsedServiceLog {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  // Build a case-insensitive, trim-safe column key index once (all rows share the same header shape).
  // Resolves 'Facility Name' vs 'Facility', 'Stylist Name' vs 'Stylist', etc.
  const keyMap = new Map<string, string>() // normalizedName → actualKey
  for (const k of Object.keys(raw[0] ?? {})) keyMap.set(k.toLowerCase().trim(), k)
  const resolveKey = (...names: string[]): string | undefined => {
    for (const n of names) {
      const found = keyMap.get(n.toLowerCase().trim())
      if (found !== undefined) return found
    }
    return undefined
  }
  const get = (r: Record<string, unknown>, key: string | undefined): unknown =>
    key !== undefined ? r[key] : ''

  const facilityKey   = resolveKey('Facility Name', 'Facility')
  const stylistKey    = resolveKey('Stylist Name', 'Stylist')
  const clientKey     = resolveKey('Client Name')
  const serviceDateKey = resolveKey('Service Date')
  const servicesKey   = resolveKey('Services Performed')
  const amountKey     = resolveKey('Amount')
  const roomKey       = resolveKey('Room#', 'Room')
  const tipsKey       = resolveKey('Tips')
  const notesKey      = resolveKey('Notes')
  const paymentKey    = resolveKey('Payment Type')

  // Collect all non-empty, non-skip values for facility and stylist, then pick most frequent.
  const facilityValues: string[] = []
  const stylistValues: string[] = []

  const rows: ParsedServiceLogRow[] = []
  for (const r of raw) {
    // Facility cells may include an F-code prefix: "F177 - Sunrise of Bethesda" → "Sunrise of Bethesda"
    const rawF = String(get(r, facilityKey) ?? '').trim()
    const fSegs = rawF.split(' - ')
    const f = (fSegs.length >= 2 && /^F\d+$/.test(fSegs[0].trim()))
      ? fSegs.slice(1).join(' - ').trim()
      : rawF
    if (f && !SKIP_META.has(f.toLowerCase())) facilityValues.push(f)

    const s = String(get(r, stylistKey) ?? '').trim()
    if (s && !SKIP_META.has(s.toLowerCase())) stylistValues.push(s)

    const clientName = String(get(r, clientKey) ?? '').trim()
    if (SKIP_CLIENT.has(clientName.toLowerCase())) continue

    const serviceDate = toDate(get(r, serviceDateKey))
    if (!serviceDate) continue

    const servicesPerformed = String(get(r, servicesKey) ?? '').trim()
    const amountCents = toCents(get(r, amountKey))
    if (amountCents <= 0) continue

    const roomVal = String(get(r, roomKey) ?? '').trim()
    const tipsCents = toCents(get(r, tipsKey))

    rows.push({
      serviceDate,
      clientName,
      room: roomVal && roomVal.toLowerCase() !== "doesn't fill" ? roomVal : null,
      servicesPerformed,
      amountCents,
      notes: String(get(r, notesKey) ?? '').trim() || null,
      tipsCents: tipsCents > 0 ? tipsCents : null,
      paymentType: String(get(r, paymentKey) ?? '').trim() || null,
    })
  }

  let facility = mostFrequent(facilityValues)

  // Fallback: parse facility from filename ("F177 - Sunrise of Bethesda.xlsx" → "Sunrise of Bethesda")
  if (!facility && fileName) {
    const base = fileName.replace(/\.[^/.]+$/, '')
    const segments = base.split(' - ')
    const last = segments[segments.length - 1].trim()
    if (last) facility = last
  }

  const stylistCell = mostFrequent(stylistValues)
  const { stylistCode, stylistName } = splitStylistCell(stylistCell)
  return { rows, meta: { facility, stylist: stylistName, stylistCode } }
}

// Return all subsets of `items` of size 2..maxSize.
// Caller is responsible for the factorial guard.
export function enumerateCombos<T>(items: T[], maxSize: number): T[][] {
  const result: T[][] = []
  const n = items.length
  for (let size = 2; size <= maxSize; size++) {
    if (size > n) break
    const indices = Array.from({ length: size }, (_, i) => i)
    while (true) {
      result.push(indices.map((i) => items[i]))
      // bump indices like a counter
      let i = size - 1
      while (i >= 0 && indices[i] === n - size + i) i--
      if (i < 0) break
      indices[i]++
      for (let j = i + 1; j < size; j++) indices[j] = indices[j - 1] + 1
    }
  }
  return result
}

// Cascading match: name fuzzy → exact price → combo → unmatched.
export function matchService(
  rawServiceName: string,
  amountCents: number,
  services: ServiceCandidate[],
): ServiceMatch {
  const active = services.filter((s) => s.active && s.pricingType !== 'addon')
  const trimmed = rawServiceName.trim()

  // (a) Fuzzy name match at 0.72
  if (trimmed) {
    const named = fuzzyBestMatch(active, trimmed, 0.72)
    if (named) return { kind: 'name', serviceIds: [named.id], needsReview: false }
  }

  // (b) Exact price match — only when unique
  const exact = active.filter((s) => s.priceCents === amountCents)
  if (exact.length === 1) return { kind: 'price', serviceIds: [exact[0].id], needsReview: false }

  // (c) Combo. Cap size to 3 unless catalog is small (< 30) — factorial guard.
  const maxSize = active.length > 30 ? 2 : 3
  const combos = enumerateCombos(active, maxSize).filter(
    (combo) => combo.reduce((s, x) => s + x.priceCents, 0) === amountCents,
  )
  if (combos.length === 1) {
    return { kind: 'combo', serviceIds: combos[0].map((s) => s.id), needsReview: false }
  }
  if (combos.length > 1 && trimmed) {
    // pick the combo whose concatenated names best match the raw string
    const ranked = combos
      .map((combo) => ({
        ids: combo.map((s) => s.id),
        score: fuzzyScore(combo.map((s) => s.name).join(' '), trimmed),
      }))
      .sort((a, b) => b.score - a.score)
    if (ranked[0].score > 0) {
      return { kind: 'combo', serviceIds: ranked[0].ids, needsReview: false }
    }
  }

  // (d) Unmatched
  return { kind: 'unmatched', serviceIds: [], needsReview: true }
}

// Convert a "service date" (UTC midnight from XLSX) into a UTC instant
// representing 12:00 noon in the facility's local timezone (DST-aware).
export function serviceDateAtNoonInTz(date: Date, tz: string): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const d = date.getUTCDate()
  // Find the UTC instant whose local representation in `tz` is y-m-d 12:00:00.
  // DST means the offset changes; iterate twice to converge.
  let candidate = Date.UTC(y, m, d, 12, 0, 0)
  for (let i = 0; i < 2; i++) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(candidate)).map((p) => [p.type, p.value]),
    )
    const localHour = Number(parts.hour ?? '12')
    const localY = Number(parts.year)
    const localM = Number(parts.month) - 1
    const localD = Number(parts.day)
    const drift =
      (Date.UTC(localY, localM, localD, localHour, Number(parts.minute ?? '0')) -
        Date.UTC(y, m, d, 12, 0)) /
      60_000
    candidate -= drift * 60_000
  }
  return new Date(candidate)
}

// Convert a "service date" to the UTC instant representing
// 9:00am + slotIndex×30min in the facility's local timezone (DST-aware).
export function facilityDateAt9amPlusSlot(date: Date, tz: string, slotIndex: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const d = date.getUTCDate()
  const targetMinutes = 9 * 60 + slotIndex * 30
  const targetHour = Math.floor(targetMinutes / 60)
  const targetMin = targetMinutes % 60
  let candidate = Date.UTC(y, m, d, targetHour, targetMin, 0)
  for (let i = 0; i < 2; i++) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(candidate)).map((p) => [p.type, p.value]),
    )
    const localHour = Number(parts.hour ?? String(targetHour))
    const localMin = Number(parts.minute ?? String(targetMin))
    const localY = Number(parts.year)
    const localM = Number(parts.month) - 1
    const localD = Number(parts.day)
    const drift =
      (Date.UTC(localY, localM, localD, localHour, localMin) -
        Date.UTC(y, m, d, targetHour, targetMin)) /
      60_000
    candidate -= drift * 60_000
  }
  return new Date(candidate)
}

// Resident lookup helper — fuzzy match against an in-memory list at 0.85.
export function findResidentByName(
  name: string,
  pool: { id: string; name: string }[],
): string | null {
  const target = normalizeWords(name).join(' ')
  if (!target) return null
  const hit = fuzzyBestMatch(pool, name, 0.85)
  return hit?.id ?? null
}
