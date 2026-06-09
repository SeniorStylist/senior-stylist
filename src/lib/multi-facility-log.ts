/**
 * Multi-facility service-log parser.
 *
 * The bookkeepers send one workbook containing EVERY facility's daily log
 * (each row carries its own `F### - Name` facility cell and `ST### - Name`
 * stylist cell), across one or more tabs. This module parses that workbook in
 * the browser and groups the rows by facility code so the client can POST one
 * facility at a time.
 *
 * Dynamically imported (`await import('@/lib/multi-facility-log')`) so `xlsx`
 * stays out of the main client bundle.
 */

import * as XLSX from 'xlsx'
import { toCents, toDate, splitFacilityCell, splitStylistCell } from '@/lib/service-log-import'

export interface MultiFacilityLogRow {
  serviceDate: string // ISO string — UTC midnight of the service date
  clientName: string
  room: string | null
  servicesPerformed: string
  amountCents: number
  notes: string | null
  tipsCents: number | null
  paymentType: string | null
  stylistCode: string | null
  stylistName: string
}

export interface MultiFacilityGroup {
  facilityCode: string
  facilityName: string
  paymentTypeHint: 'rfms' | 'ip'
  rows: MultiFacilityLogRow[]
  stylistCount: number
}

export interface ParsedMultiFacilityLog {
  groups: MultiFacilityGroup[]
  totalRows: number
  totalFacilities: number
  totalStylists: number
  /** Rows skipped for missing facility code, unusable amount, or "Doesn't Fill" client. */
  skippedRows: number
  /** Distinct facility cells that lacked an F-code prefix (cannot be imported). */
  uncodedFacilities: string[]
}

const SKIP_CLIENT = new Set(["doesn't fill", 'doesnt fill', "doesn't fill in", ''])

// "Doesn't Fill" is the bookkeepers' placeholder for an empty cell — treat it as null.
function cleanCell(value: unknown): string | null {
  const s = String(value ?? '').trim()
  if (!s || s === '-' || s.toLowerCase() === "doesn't fill") return null
  return s
}

interface GroupAccum {
  facilityCode: string
  nameCounts: Map<string, number>
  ipRows: number
  rfmsRows: number
  rows: MultiFacilityLogRow[]
  stylistCodes: Set<string>
}

export function parseMultiFacilityServiceLog(
  data: ArrayBuffer | Buffer,
): ParsedMultiFacilityLog {
  const workbook = XLSX.read(data, { type: 'buffer', cellDates: true })

  const groups = new Map<string, GroupAccum>()
  const uncoded = new Set<string>()
  const allStylists = new Set<string>()
  let totalRows = 0
  let skippedRows = 0

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    if (raw.length === 0) continue

    // Tab name implies billing type: anything mentioning "IP" → IP billing, else RFMS.
    const tabIsIp = /\bip\b/i.test(sheetName)

    // Resolve column keys once per sheet (header shape is uniform within a sheet).
    const keyMap = new Map<string, string>()
    for (const k of Object.keys(raw[0] ?? {})) keyMap.set(k.toLowerCase().trim(), k)
    const resolveKey = (...names: string[]): string | undefined => {
      for (const n of names) {
        const found = keyMap.get(n.toLowerCase().trim())
        if (found !== undefined) return found
      }
      return undefined
    }
    const facilityKey = resolveKey('Facility Name', 'Facility')
    const stylistKey = resolveKey('Stylist Name', 'Stylist')
    const clientKey = resolveKey('Client Name')
    const serviceDateKey = resolveKey('Service Date')
    const servicesKey = resolveKey('Services Performed')
    const amountKey = resolveKey('Amount')
    const roomKey = resolveKey('Room#', 'Room')
    const tipsKey = resolveKey('Tips')
    const notesKey = resolveKey('Notes')
    const paymentKey = resolveKey('Payment Type')

    const get = (r: Record<string, unknown>, key: string | undefined): unknown =>
      key !== undefined ? r[key] : ''

    for (const r of raw) {
      const rawFacility = String(get(r, facilityKey) ?? '').trim()
      const { facilityCode, facilityName } = splitFacilityCell(rawFacility)
      if (!facilityCode) {
        if (rawFacility) uncoded.add(rawFacility)
        skippedRows += 1
        continue
      }

      const clientName = String(get(r, clientKey) ?? '').trim()
      if (SKIP_CLIENT.has(clientName.toLowerCase())) { skippedRows += 1; continue }

      const serviceDate = toDate(get(r, serviceDateKey))
      if (!serviceDate) { skippedRows += 1; continue }

      const amountCents = toCents(get(r, amountKey))
      if (amountCents <= 0) { skippedRows += 1; continue }

      const { stylistCode, stylistName } = splitStylistCell(String(get(r, stylistKey) ?? '').trim())
      const roomVal = String(get(r, roomKey) ?? '').trim()
      const tipsCents = toCents(get(r, tipsKey))

      const row: MultiFacilityLogRow = {
        serviceDate: serviceDate.toISOString(),
        clientName,
        room: cleanCell(roomVal),
        servicesPerformed: String(get(r, servicesKey) ?? '').trim(),
        amountCents,
        notes: cleanCell(get(r, notesKey)),
        tipsCents: tipsCents > 0 ? tipsCents : null,
        paymentType: cleanCell(get(r, paymentKey)),
        stylistCode,
        stylistName,
      }

      let g = groups.get(facilityCode)
      if (!g) {
        g = {
          facilityCode,
          nameCounts: new Map(),
          ipRows: 0,
          rfmsRows: 0,
          rows: [],
          stylistCodes: new Set(),
        }
        groups.set(facilityCode, g)
      }
      g.rows.push(row)
      g.nameCounts.set(facilityName, (g.nameCounts.get(facilityName) ?? 0) + 1)
      if (tabIsIp) g.ipRows += 1
      else g.rfmsRows += 1
      if (stylistCode) { g.stylistCodes.add(stylistCode); allStylists.add(stylistCode) }
      totalRows += 1
    }
  }

  const resultGroups: MultiFacilityGroup[] = [...groups.values()]
    .map((g) => ({
      facilityCode: g.facilityCode,
      facilityName: mostFrequentName(g.nameCounts),
      paymentTypeHint: (g.ipRows > g.rfmsRows ? 'ip' : 'rfms') as 'ip' | 'rfms',
      rows: g.rows,
      stylistCount: g.stylistCodes.size,
    }))
    .sort((a, b) => b.rows.length - a.rows.length)

  return {
    groups: resultGroups,
    totalRows,
    totalFacilities: resultGroups.length,
    totalStylists: allStylists.size,
    skippedRows,
    uncodedFacilities: [...uncoded],
  }
}

function mostFrequentName(counts: Map<string, number>): string {
  let best = ''
  let bestCount = -1
  for (const [name, c] of counts) {
    if (c > bestCount) { bestCount = c; best = name }
  }
  return best
}
