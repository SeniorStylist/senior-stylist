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

export function parseServiceLogXlsx(buffer: Buffer): ParsedServiceLog {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })

  let facility = ''
  let stylistCell = ''

  const rows: ParsedServiceLogRow[] = []
  for (const r of raw) {
    if (!facility) {
      const f = String(r['Facility'] ?? '').trim()
      if (f) facility = f
    }
    if (!stylistCell) {
      const s = String(r['Stylist'] ?? '').trim()
      if (s) stylistCell = s
    }

    const clientName = String(r['Client Name'] ?? '').trim()
    if (SKIP_CLIENT.has(clientName.toLowerCase())) continue

    const serviceDate = toDate(r['Service Date'])
    if (!serviceDate) continue

    const servicesPerformed = String(r['Services Performed'] ?? '').trim()
    const amountCents = toCents(r['Amount'])
    if (amountCents <= 0) continue

    const roomVal = String(r['Room#'] ?? '').trim()
    const tipsCents = toCents(r['Tips'])

    rows.push({
      serviceDate,
      clientName,
      room: roomVal && roomVal.toLowerCase() !== "doesn't fill" ? roomVal : null,
      servicesPerformed,
      amountCents,
      notes: String(r['Notes'] ?? '').trim() || null,
      tipsCents: tipsCents > 0 ? tipsCents : null,
      paymentType: String(r['Payment Type'] ?? '').trim() || null,
    })
  }

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
