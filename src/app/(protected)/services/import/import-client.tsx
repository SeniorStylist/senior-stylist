'use client'

import { useState, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { fuzzyBestMatch, fuzzyScore } from '@/lib/fuzzy'
import { isPerUnitService, makePerUnitTiers } from '@/lib/pricing'

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedService {
  id: number
  name: string
  priceCents: number
  durationMinutes: number
  color: string
  category: string
  include: boolean
  error?: string
  pricingType?: string
  addonAmountCents?: number | null
  pricingTiers?: Array<{ minQty: number; maxQty: number; unitPriceCents: number }> | null
  pricingOptions?: Array<{ name: string; priceCents: number }> | null
}

type Step = 'upload' | 'preview' | 'importing' | 'done'

interface DoneResult {
  created: number
  skipped: number
}

interface DuplicateRow {
  parsedService: ParsedService
  existingService: { id: string; name: string; priceCents: number }
  resolution: 'replace' | 'skip'
}

type Mode = 'add' | 'update'

// An existing service, loaded in "Update prices" mode so scanned rows can be
// matched against the facility's real services and have their prices overwritten.
interface ExistingService {
  id: string
  name: string
  priceCents: number
  pricingType: string | null
  addonAmountCents: number | null
}

// One scanned row resolved against the existing services for a price update.
interface UpdateRow {
  rowId: number
  scannedName: string
  newCents: number          // effective new amount (add-on amount for add-ons, else price)
  matchId: string | null    // existing service to overwrite (user-overridable)
  score: number             // fuzzy-match confidence
  apply: boolean
}

// The dollar amount that represents a service's "price" regardless of type —
// add-ons carry it in addonAmountCents, everything else in priceCents.
const scannedAmount = (p: ParsedService) =>
  p.pricingType === 'addon' ? (p.addonAmountCents ?? 0) : p.priceCents
const existingAmount = (s: ExistingService) =>
  s.pricingType === 'addon' ? (s.addonAmountCents ?? 0) : s.priceCents

// ─── Constants ────────────────────────────────────────────────────────────────

const COLORS = ['#0D7377', '#E57373', '#FFB74D', '#81C784', '#64B5F6', '#BA68C8', '#4DB6AC', '#FF8A65']
const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120]

// ─── Column detection ─────────────────────────────────────────────────────────

function normalize(s: string) {
  return s.toLowerCase().replace(/[\s_\-#.]/g, '')
}

const NAME_HEADERS = new Set([
  'name', 'service', 'servicename', 'description', 'item',
])
const PRICE_HEADERS = new Set([
  'price', 'cost', 'amount', 'rate', 'charge', 'fee',
])
const DURATION_HEADERS = new Set([
  'duration', 'time', 'minutes', 'mins', 'min', 'length',
])

function detectColumns(headers: string[]): { nameIdx: number; priceIdx: number; durationIdx: number } {
  let nameIdx = -1
  let priceIdx = -1
  let durationIdx = -1
  headers.forEach((h, i) => {
    const n = normalize(h)
    if (nameIdx === -1 && NAME_HEADERS.has(n)) nameIdx = i
    if (priceIdx === -1 && PRICE_HEADERS.has(n)) priceIdx = i
    if (durationIdx === -1 && DURATION_HEADERS.has(n)) durationIdx = i
  })
  // Fallback: first column is name
  if (nameIdx === -1) nameIdx = 0
  return { nameIdx, priceIdx, durationIdx }
}

// ─── Price parsing ────────────────────────────────────────────────────────────

function parsePriceToCents(value: string | number): number {
  if (typeof value === 'number') return Math.round(value * 100)
  const cleaned = String(value).replace(/[^0-9.]/g, '')
  const num = parseFloat(cleaned)
  if (isNaN(num)) return 0
  return Math.round(num * 100)
}

// ─── Per-row validation flag ──────────────────────────────────────────────────
// Single source of truth for a row's `error`. An add-on row is judged on its
// add-on amount; tiered / multi-option rows keep their real prices in their
// arrays, so a $0 base price is expected and never flagged.
function rowError(
  name: string,
  pricingType: string | undefined,
  priceCents: number,
  addonAmountCents: number | null,
): ParsedService['error'] {
  if (!name.trim()) return 'Missing name'
  if (pricingType === 'tiered' || pricingType === 'multi_option') return undefined
  const amount = pricingType === 'addon' ? (addonAmountCents ?? 0) : priceCents
  return amount === 0 ? 'Price is $0' : undefined
}

// Converts a review row's pricing fields into the server payload. 'per_unit' is a
// UI-only marker → a single open-ended tier so it reuses the tiered booking flow.
function rowPricingPayload(r: ParsedService) {
  if (r.pricingType === 'per_unit') {
    const unit = Math.round(r.priceCents)
    return {
      pricingType: 'tiered' as const,
      priceCents: unit,
      addonAmountCents: null,
      pricingTiers: makePerUnitTiers(unit),
      pricingOptions: null,
    }
  }
  return {
    pricingType: r.pricingType,
    priceCents: r.pricingType === 'addon' ? 0 : Math.round(r.priceCents),
    addonAmountCents: r.pricingType === 'addon' ? Math.round(r.addonAmountCents ?? 0) : null,
    pricingTiers: r.pricingType === 'tiered' ? r.pricingTiers ?? null : null,
    pricingOptions: r.pricingType === 'multi_option' ? r.pricingOptions ?? null : null,
  }
}

// ─── CSV parser (papaparse) ──────────────────────────────────────────────────

async function parseCSV(file: File): Promise<string[][]> {
  const Papa = (await import('papaparse')).default
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (result) => resolve(result.data as string[][]),
      error: reject,
    })
  })
}

// ─── Excel parser (xlsx) ─────────────────────────────────────────────────────

async function parseExcel(file: File): Promise<string[][]> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

// ─── Spreadsheet → grid text (for the AI parser) ─────────────────────────────
// Reads EVERY sheet so nothing is missed, and preserves the cell layout as a
// tab-separated grid the AI can read like a PDF.

function rowsToTsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => String(c ?? '').trim()).join('\t'))
    .join('\n')
}

async function spreadsheetToGridText(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'csv' || ext === 'txt') {
    return rowsToTsv(await parseCSV(file))
  }
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const parts: string[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ''))
    if (nonEmpty.length === 0) continue
    if (wb.SheetNames.length > 1) parts.push(`### Sheet: ${name}`)
    parts.push(rowsToTsv(nonEmpty))
  }
  return parts.join('\n\n')
}

// ─── Word (.docx) → grid text (for the AI parser) ────────────────────────────
// Word price sheets are tab-separated paragraphs ("Service<tab…>Price") and/or
// tables. We unzip the docx and read word/document.xml directly so the name↔price
// separation survives (one tab per gap), then hand the grid to the same AI parser.

async function docxToGridText(file: File): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const docXml = zip.file('word/document.xml')
  if (!docXml) throw new Error('This doesn’t look like a Word document.')
  const xml = await docXml.async('string')
  const unescape = (s: string) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

  const lines: string[] = []
  const blocks = xml.match(/<w:tr\b[\s\S]*?<\/w:tr>|<w:p\b[\s\S]*?<\/w:p>/g) ?? []
  for (const b of blocks) {
    if (b.startsWith('<w:tr')) {
      // Table row → tab-joined cells
      const cells = (b.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) =>
        (c.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
          .map((t) => unescape(t.replace(/<[^>]+>/g, '')))
          .join('')
          .trim()
      )
      if (cells.some(Boolean)) lines.push(cells.join('\t'))
    } else {
      // Paragraph → text with one tab per run of <w:tab/>
      let out = ''
      for (const m of b.matchAll(/<w:tab\b[^>]*\/>|<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) {
        out += m[0].startsWith('<w:tab') ? '\t' : unescape(m[1])
      }
      out = out.replace(/\t+/g, '\t').trim()
      if (out) lines.push(out)
    }
  }
  return lines.join('\n')
}

// ─── AI parser (server-side, shared by PDF + spreadsheet) ────────────────────

async function postToAIParser(formData: FormData): Promise<ParsedService[]> {
  const res = await fetch('/api/services/parse-pdf', {
    method: 'POST',
    body: formData,
  })
  // Read as text first: a platform-level failure (timeout, crash, or an auth
  // redirect to the HTML /login page) returns HTML, not JSON. Doing res.json()
  // on that throws a cryptic "Unexpected token '<'" — surface the real reason.
  const raw = await res.text()
  let json: { data?: unknown; error?: unknown } | null = null
  try { json = JSON.parse(raw) } catch { /* non-JSON (HTML error page) */ }
  if (!json) {
    const reason =
      res.status === 401 || res.status === 403
        ? 'Your session expired or you don’t have access. Refresh the page, sign in again, and retry.'
        : res.status === 413
          ? 'This file is too large to parse.'
          : res.status === 504 || res.status === 408
            ? 'The parser timed out. Please try again.'
            : `The parser returned an unexpected response (HTTP ${res.status}). Please try again.`
    throw new Error(reason)
  }
  if (!res.ok) {
    throw new Error(typeof json.error === 'string' ? json.error : `Failed to parse price sheet (HTTP ${res.status})`)
  }
  const rows: Array<{
    name: string; priceCents: number; durationMinutes: number; category: string; color: string
    pricingType?: string; addonAmountCents?: number | null
    pricingTiers?: Array<{ minQty: number; maxQty: number; unitPriceCents: number }> | null
    pricingOptions?: Array<{ name: string; priceCents: number }> | null
  }> = (json.data as typeof rows) ?? []
  return rows.map((r, i) => {
    // A single open-ended tier from the AI ("$8 ea") is a flat per-unit price.
    // Normalize it to the 'per_unit' UI marker with the unit price in priceCents
    // so the review row shows "$8.00 each" instead of a confusing $0.00 (tiered
    // rows carry their price in the tiers array, not priceCents).
    const perUnit = isPerUnitService({ pricingType: r.pricingType ?? 'fixed', pricingTiers: r.pricingTiers ?? null })
    return {
      id: i,
      name: r.name,
      priceCents: perUnit ? (r.pricingTiers?.[0]?.unitPriceCents ?? r.priceCents) : r.priceCents,
      durationMinutes: r.durationMinutes,
      category: r.category,
      color: r.color,
      include: true,
      pricingType: perUnit ? 'per_unit' : r.pricingType,
      addonAmountCents: r.addonAmountCents ?? null,
      pricingTiers: perUnit ? null : (r.pricingTiers ?? null),
      pricingOptions: r.pricingOptions ?? null,
    }
  })
}

// PDFs and images are sent straight to Gemini (inlineData) — it reads the visual
// layout directly. Used for .pdf and image files (screenshots/photos of a sheet).
async function parseFileViaVision(file: File): Promise<ParsedService[]> {
  const formData = new FormData()
  formData.append('file', file)
  const rows = await postToAIParser(formData)
  if (rows.length === 0) throw new Error('No services found in this file. Make sure it lists service names with prices.')
  return rows
}

// Spreadsheets AND Word docs go through the SAME AI parser as PDFs — converted
// to a text grid first — so messy real-world price sheets (section headers, prose,
// blank cells, irregular columns) are read intelligently, not mapped row-for-row.
async function parseGridTextAI(file: File): Promise<ParsedService[]> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const gridText = ext === 'docx' ? await docxToGridText(file) : await spreadsheetToGridText(file)
  if (!gridText.trim()) throw new Error('File appears to be empty.')
  const formData = new FormData()
  formData.append('gridText', gridText)
  return postToAIParser(formData)
}

// ─── Spreadsheet parser — naive column mapping (fallback when AI is unavailable) ──

async function parseSpreadsheetNaive(file: File): Promise<ParsedService[]> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  let rows: string[][]

  if (ext === 'csv' || ext === 'txt') {
    rows = await parseCSV(file)
  } else if (ext === 'xlsx' || ext === 'xls') {
    rows = await parseExcel(file)
  } else {
    throw new Error('Unsupported file type.')
  }

  if (rows.length < 2) throw new Error('File appears to be empty or has only a header row.')

  const headers = rows[0].map(String)
  const { nameIdx, priceIdx, durationIdx } = detectColumns(headers)
  const dataRows = rows.slice(1)

  return dataRows.map((row, i) => {
    const name = String(row[nameIdx] ?? '').trim()
    const priceCents = priceIdx >= 0 ? parsePriceToCents(row[priceIdx]) : 0
    const durationMinutes = durationIdx >= 0 ? (parseInt(String(row[durationIdx])) || 30) : 30
    const hasError = name.length === 0
    return {
      id: i,
      name,
      priceCents,
      durationMinutes: DURATION_OPTIONS.includes(durationMinutes) ? durationMinutes : 30,
      color: COLORS[i % COLORS.length],
      category: '',
      include: !hasError,
      error: hasError ? 'Missing name' : (priceCents === 0 ? 'Price is $0' : undefined),
    }
  })
}

// ─── Main parser ─────────────────────────────────────────────────────────────

// Only a sheet with a REAL header row (recognized name + price columns) is safe
// for the naive column-mapper. Free-form price sheets (section headers, prose,
// irregular columns) must never hit it — it turns every row into a garbage service.
async function looksTabular(file: File): Promise<boolean> {
  try {
    const ext = file.name.split('.').pop()?.toLowerCase()
    const rows = ext === 'csv' || ext === 'txt' ? await parseCSV(file) : await parseExcel(file)
    if (rows.length < 2) return false
    const headers = rows[0].map((h) => normalize(String(h)))
    return headers.some((h) => NAME_HEADERS.has(h)) && headers.some((h) => PRICE_HEADERS.has(h))
  } catch {
    return false
  }
}

const VISION_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif'])

async function parseFile(file: File): Promise<ParsedService[]> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  // PDFs + images → Gemini vision (reads the visual layout directly).
  if (ext && VISION_EXTS.has(ext)) {
    return parseFileViaVision(file)
  }
  // Word docs (.docx) have no tabular fallback — they're always free-form text.
  if (ext === 'docx') {
    const ai = await parseGridTextAI(file)
    if (ai.length > 0) return ai
    throw new Error('No services could be read from this document. Make sure it lists service names with prices.')
  }
  // Spreadsheets go through the AI parser (reads messy real-world sheets like a PDF).
  try {
    const ai = await parseGridTextAI(file)
    if (ai.length > 0) return ai
    // AI ran but found nothing — surface that instead of dumping every row as garbage.
    throw new Error('No services could be read from this sheet. Make sure it lists service names with prices.')
  } catch (err) {
    // Fall back to naive column-mapping ONLY for clean tabular sheets — never for
    // free-form price sheets (that path is what produced the "Missing name" garbage).
    if (await looksTabular(file)) return parseSpreadsheetNaive(file)
    throw err instanceof Error ? err : new Error('Could not read this price sheet. Please try again.')
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportClient({ initialMode = 'add' }: { initialMode?: Mode }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [step, setStep] = useState<Step>('upload')
  const [dragging, setDragging] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ParsedService[]>([])
  const [importProgress, setImportProgress] = useState(0)
  const [result, setResult] = useState<DoneResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateRow[]>([])
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [progress, setProgress] = useState(0)

  // Update-mode state
  const [existingServices, setExistingServices] = useState<ExistingService[]>([])
  const [updateRows, setUpdateRows] = useState<UpdateRow[]>([])
  const [updateResult, setUpdateResult] = useState<{ updated: number; unchanged: number; skipped: number } | null>(null)

  const selectedCount = rows.filter((r) => r.include && r.error !== 'Missing name').length
  const errorCount = rows.filter((r) => r.error === 'Missing name').length

  const existingById = useMemo(
    () => new Map(existingServices.map((s) => [s.id, s])),
    [existingServices]
  )
  const sortedExisting = useMemo(
    () => [...existingServices].sort((a, b) => a.name.localeCompare(b.name)),
    [existingServices]
  )
  const updateSelectedCount = updateRows.filter((r) => r.apply && r.matchId).length
  const updateNoMatchCount = updateRows.filter((r) => !r.matchId).length

  // ── File handling ──────────────────────────────────────────────────────────

  // In update mode, resolve each scanned row against the facility's existing
  // services (fuzzy name match) and default to applying the change when a match
  // exists and the price actually differs.
  const buildUpdateRows = useCallback(async (parsed: ParsedService[]) => {
    const res = await fetch('/api/services')
    const json = await res.json()
    if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to load services')
    const existing: ExistingService[] = json.data ?? []
    setExistingServices(existing)
    const existingByIdLocal = new Map(existing.map((s) => [s.id, s]))
    const built: UpdateRow[] = parsed.map((p) => {
      const match = fuzzyBestMatch(existing, p.name, 0.7)
      const newCents = scannedAmount(p)
      const changed = match ? existingAmount(existingByIdLocal.get(match.id)!) !== newCents : false
      return {
        rowId: p.id,
        scannedName: p.name,
        newCents,
        matchId: match?.id ?? null,
        score: match ? fuzzyScore(p.name, match.name) : 0,
        apply: !!match && changed,
      }
    })
    setUpdateRows(built)
  }, [])

  const handleFile = useCallback(async (file: File) => {
    setParseError(null)
    setFileName(file.name)
    // Every format now goes through the AI parser (PDF directly, spreadsheets as a
    // cell grid), so show the progress overlay for all of them.
    setParsing(true)
    setProgress(0)
    setTimeout(() => setProgress(70), 50)
    try {
      const parsed = await parseFile(file)
      if (mode === 'update') await buildUpdateRows(parsed)
      setProgress(100)
      await new Promise((r) => setTimeout(r, 400))
      setRows(parsed)
      setStep('preview')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file')
    } finally {
      setParsing(false)
    }
  }, [mode, buildUpdateRows])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  // ── Row editing ────────────────────────────────────────────────────────────

  const toggleRow = (id: number) =>
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, include: !r.include } : r))

  const updateName = (id: number, name: string) =>
    setRows((prev) => prev.map((r) =>
      r.id === id ? { ...r, name, error: rowError(name, r.pricingType, r.priceCents, r.addonAmountCents ?? null) } : r
    ))

  const updatePrice = (id: number, dollars: string) => {
    const cents = parsePriceToCents(dollars)
    setRows((prev) => prev.map((r) =>
      r.id === id ? { ...r, priceCents: cents, error: rowError(r.name, r.pricingType, cents, r.addonAmountCents ?? null) } : r
    ))
  }

  const updateDuration = (id: number, minutes: number) =>
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, durationMinutes: minutes } : r))

  const updateColor = (id: number, color: string) =>
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, color } : r))

  // Switching type carries the dollar amount across so it's never lost: the
  // visible amount lives in priceCents for non-addon types and in addonAmountCents
  // for addon. (Fixes the case where the AI mis-tags a real service as an add-on —
  // flipping it to Fixed keeps the dollar value instead of zeroing it.)
  const updatePricingType = (id: number, type: string) =>
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r
      const currentCents = r.pricingType === 'addon' ? (r.addonAmountCents ?? 0) : r.priceCents
      const priceCents = type === 'addon' ? 0 : currentCents
      const addonAmountCents = type === 'addon' ? currentCents : null
      return { ...r, pricingType: type, priceCents, addonAmountCents, error: rowError(r.name, type, priceCents, addonAmountCents) }
    }))

  const updateAddonAmount = (id: number, dollars: string) => {
    const cents = parsePriceToCents(dollars)
    setRows((prev) => prev.map((r) =>
      r.id === id ? { ...r, addonAmountCents: cents, error: rowError(r.name, r.pricingType, r.priceCents, cents) } : r
    ))
  }

  const toggleAll = () => {
    const anyOn = rows.some((r) => r.include && r.error !== 'Missing name')
    setRows((prev) => prev.map((r) => ({ ...r, include: r.error === 'Missing name' ? false : !anyOn })))
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  const runImport = async (toImport: ParsedService[], resolvedDuplicates: DuplicateRow[]) => {
    setStep('importing')
    setImportProgress(0)
    setImportError(null)

    const replaceRows = resolvedDuplicates.filter((d) => d.resolution === 'replace')
    const skipNames = new Set(
      resolvedDuplicates
        .filter((d) => d.resolution === 'skip')
        .map((d) => d.parsedService.name.trim().toLowerCase())
    )
    const replaceNames = new Set(replaceRows.map((d) => d.parsedService.name.trim().toLowerCase()))

    // Exclude skipped duplicates; also exclude rows that will be handled via PUT
    const newRows = toImport.filter(
      (r) => !skipNames.has(r.name.trim().toLowerCase()) && !replaceNames.has(r.name.trim().toLowerCase())
    )

    const BATCH = 100
    let totalCreated = 0
    let totalSkipped = 0

    try {
      // Handle replacements via individual PUT to existing service. Send the full
      // pricing shape (type + amount) so an edited type isn't lost on replace, and
      // surface failures instead of silently counting them as created.
      for (const dup of replaceRows) {
        const ps = dup.parsedService
        const res = await fetch(`/api/services/${dup.existingService.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            durationMinutes: ps.durationMinutes,
            color: ps.color,
            ...rowPricingPayload(ps),
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => null)
          throw new Error(typeof j?.error === 'string' ? j.error : 'Failed to update existing service')
        }
        totalCreated++
      }

      // Bulk-insert new rows
      for (let i = 0; i < newRows.length; i += BATCH) {
        const chunk = newRows.slice(i, i + BATCH)
        const res = await fetch('/api/services/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: chunk.map((r) => ({
              name: r.name.trim(),
              durationMinutes: r.durationMinutes,
              color: r.color,
              category: r.category ?? null,
              ...rowPricingPayload(r),
            })),
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Import failed')
        totalCreated += json.data.created
        totalSkipped += json.data.skipped
        setImportProgress(Math.round(((i + chunk.length) / Math.max(newRows.length, 1)) * 100))
      }

      setResult({ created: totalCreated, skipped: totalSkipped + skipNames.size })
      setStep('done')
      router.refresh() // invalidate the /services Router Cache so the new rows show immediately
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
      setStep('preview')
    }
  }

  const handleImport = async () => {
    const toImport = rows.filter((r) => r.include && r.error !== 'Missing name')
    if (toImport.length === 0) return

    // Pre-flight: check for name collisions with existing services
    try {
      const res = await fetch('/api/services')
      const json = await res.json()
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to load services')

      const existing: { id: string; name: string; priceCents: number }[] = json.data ?? []
      const existingByName = new Map(existing.map((s) => [s.name.trim().toLowerCase(), s]))

      const found: DuplicateRow[] = []
      for (const ps of toImport) {
        const match = existingByName.get(ps.name.trim().toLowerCase())
        if (match) {
          found.push({ parsedService: ps, existingService: match, resolution: 'skip' })
        }
      }

      if (found.length > 0) {
        setDuplicates(found)
        setShowDuplicateModal(true)
        return
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not check for duplicates')
      return
    }

    await runImport(toImport, [])
  }

  // ── Update-prices mode ───────────────────────────────────────────────────────

  // Re-point a scanned row at a different existing service (or none). Default the
  // apply checkbox to on whenever the new price actually differs from the current.
  const setMatch = (rowId: number, matchId: string) =>
    setUpdateRows((prev) => prev.map((r) => {
      if (r.rowId !== rowId) return r
      const id = matchId || null
      const ex = id ? existingById.get(id) : null
      return { ...r, matchId: id, apply: !!ex && existingAmount(ex) !== r.newCents }
    }))

  const setNewPrice = (rowId: number, value: string) =>
    setUpdateRows((prev) => prev.map((r) => {
      if (r.rowId !== rowId) return r
      const newCents = parsePriceToCents(value)
      const ex = r.matchId ? existingById.get(r.matchId) : null
      return { ...r, newCents, apply: !!ex && existingAmount(ex) !== newCents }
    }))

  const toggleApply = (rowId: number) =>
    setUpdateRows((prev) => prev.map((r) => r.rowId === rowId ? { ...r, apply: !r.apply } : r))

  const toggleAllApply = () => {
    const anyOn = updateRows.some((r) => r.apply && r.matchId)
    setUpdateRows((prev) => prev.map((r) => ({ ...r, apply: r.matchId ? !anyOn : false })))
  }

  const runUpdate = async () => {
    const toApply = updateRows.filter((r) => r.apply && r.matchId)
    if (toApply.length === 0) return
    setStep('importing')
    setImportProgress(0)
    setImportError(null)
    let updated = 0
    try {
      for (let i = 0; i < toApply.length; i++) {
        const r = toApply[i]
        const ex = existingById.get(r.matchId!)
        if (!ex) continue
        // Overwrite the field that holds this service's price for its type —
        // never change the service's type, name, or duration on a price update.
        const patch = ex.pricingType === 'addon'
          ? { addonAmountCents: r.newCents }
          : { priceCents: r.newCents }
        const res = await fetch(`/api/services/${r.matchId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => null)
          throw new Error(typeof j?.error === 'string' ? j.error : 'Failed to update price')
        }
        updated++
        setImportProgress(Math.round(((i + 1) / toApply.length) * 100))
      }
      const skipped = updateNoMatchCount
      setUpdateResult({ updated, unchanged: updateRows.length - toApply.length - skipped, skipped })
      setStep('done')
      router.refresh() // invalidate the /services Router Cache so updated prices show immediately
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Update failed')
      setStep('preview')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => (step === 'preview' ? setStep('upload') : router.push('/services'))}
          className="p-2 hover:bg-stone-100 rounded-xl transition-colors text-stone-400 hover:text-stone-600"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <h1
            className="text-2xl font-bold text-stone-900"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            {mode === 'update' ? 'Update Prices' : 'Import Services'}
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {mode === 'update'
              ? 'Scan a new price sheet to overwrite your existing prices'
              : 'Upload a price sheet to bulk-add services'}
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8">
        {(['upload', 'preview', 'done'] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <div className="w-8 h-px bg-stone-200" />}
            <div className={cn(
              'flex items-center gap-1.5 text-xs font-medium',
              step === s ? 'text-[#8B2E4A]' : (
                (s === 'preview' && (step === 'importing' || step === 'done')) ||
                (s === 'upload' && step !== 'upload')
                  ? 'text-stone-400'
                  : 'text-stone-300'
              )
            )}>
              <div className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold',
                step === s
                  ? 'bg-[#8B2E4A] text-white'
                  : (
                    (s === 'preview' && (step === 'importing' || step === 'done')) ||
                    (s === 'upload' && step !== 'upload')
                      ? 'bg-stone-200 text-stone-500'
                      : 'bg-stone-100 text-stone-300'
                  )
              )}>
                {i + 1}
              </div>
              <span className="capitalize hidden sm:inline">{s}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Step: Upload ── */}
      {step === 'upload' && (
        <div className="space-y-4">
          {/* Mode toggle */}
          <div className="inline-flex rounded-xl border border-stone-200 bg-stone-50 p-1">
            {([
              { id: 'add' as const, label: 'Add new services' },
              { id: 'update' as const, label: 'Update prices' },
            ]).map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  'px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors',
                  mode === m.id ? 'bg-white text-[#8B2E4A] shadow-sm' : 'text-stone-500 hover:text-stone-700'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          {mode === 'update' && (
            <p className="text-xs text-stone-500">
              The same scanner reads your sheet, then matches each item to a service you already
              have and shows the current price next to the new one — nothing changes until you confirm.
            </p>
          )}

          {/* Drop zone */}
          <div
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-12 cursor-pointer transition-all',
              dragging
                ? 'border-[#8B2E4A] bg-rose-50'
                : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50'
            )}
          >
            <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#e6faf9' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="1.8">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-stone-700">
                {dragging ? 'Drop to upload' : 'Drop your price sheet here'}
              </p>
              <p className="text-xs text-stone-400 mt-0.5">or click to browse</p>
            </div>
            <p className="text-xs text-stone-400">Supports .pdf, images (PNG/JPG), .docx, .csv, .xlsx, .xls</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.docx,.csv,.xlsx,.xls,image/*,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={onFileChange}
              className="sr-only"
            />
          </div>

          {parseError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {parseError}
            </div>
          )}

          {/* Format hint */}
          <div className="rounded-xl bg-stone-50 border border-stone-200 p-4">
            <p className="text-xs font-semibold text-stone-600 mb-2">Expected format</p>
            <div className="overflow-x-auto">
              <table className="text-xs text-stone-500 border-collapse">
                <thead>
                  <tr>
                    {['Service Name', 'Price', 'Duration (optional)'].map((h) => (
                      <th key={h} className="text-left font-semibold text-stone-700 border border-stone-200 px-3 py-1.5 bg-stone-100">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Haircut', '$25.00', '30'],
                    ['Perm', '$65.00', '90'],
                    ['Shampoo & Set', '$18.00', '45'],
                  ].map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className="border border-stone-200 px-3 py-1.5 bg-white">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-stone-400 mt-2">
              Column headers are detected automatically. For PDFs, each line should have a service name followed by a price (e.g. &quot;Haircut $25.00&quot;).
            </p>
          </div>
        </div>
      )}

      {/* ── Step: Preview (Add mode) ── */}
      {step === 'preview' && mode === 'add' && (
        <div className="space-y-4">
          {importError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {importError}
            </div>
          )}

          {/* Summary bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-stone-500">
              <span>
                <span className="font-semibold text-stone-900">{rows.length}</span> rows from{' '}
                <span className="font-mono text-xs text-stone-600">{fileName}</span>
              </span>
              {errorCount > 0 && (
                <span className="text-orange-600 text-xs font-medium">
                  {errorCount} row{errorCount !== 1 ? 's' : ''} with issues
                </span>
              )}
            </div>
            <button
              onClick={() => setStep('upload')}
              className="text-xs text-stone-400 hover:text-stone-600 underline underline-offset-2"
            >
              Change file
            </button>
          </div>

          {/* Preview table */}
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-stone-50 border-b border-stone-100 text-xs font-semibold text-stone-500 uppercase tracking-wide">
              <div className="col-span-1 flex items-center">
                <input
                  type="checkbox"
                  checked={rows.filter((r) => r.error !== 'Missing name').every((r) => r.include)}
                  onChange={toggleAll}
                  className="rounded accent-[#8B2E4A] w-3.5 h-3.5"
                />
              </div>
              <div className="col-span-4">Name / Type</div>
              <div className="col-span-2">Price</div>
              <div className="col-span-2">Duration</div>
              <div className="col-span-1">Color</div>
              <div className="col-span-2">Status</div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-stone-50 max-h-[420px] overflow-y-auto">
              {(() => {
                type DisplayItem =
                  | { type: 'category'; name: string; color: string }
                  | { type: 'row'; row: ParsedService }
                const displayItems: DisplayItem[] = []
                let lastCategory = ''
                for (const row of rows) {
                  if (row.category && row.category !== lastCategory) {
                    displayItems.push({ type: 'category', name: row.category, color: row.color })
                    lastCategory = row.category
                  }
                  displayItems.push({ type: 'row', row })
                }
                return displayItems.map((item, idx) => {
                  if (item.type === 'category') {
                    return (
                      <div key={`cat-${idx}`} className="flex items-center gap-2 px-4 py-1.5 bg-stone-50 border-b border-stone-100">
                        <div className="w-1 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                        <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">{item.name}</span>
                      </div>
                    )
                  }
                  const row = item.row
                  return (
                    <div
                      key={row.id}
                      className={cn(
                        'grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-sm transition-colors',
                        !row.include && 'opacity-40',
                        row.error === 'Missing name' && 'bg-red-50/50',
                        row.error === 'Price is $0' && 'bg-orange-50/40'
                      )}
                    >
                      <div className="col-span-1">
                        <input
                          type="checkbox"
                          checked={row.include}
                          disabled={row.error === 'Missing name'}
                          onChange={() => toggleRow(row.id)}
                          className="rounded accent-[#8B2E4A] w-3.5 h-3.5"
                        />
                      </div>
                      <div className="col-span-4 flex flex-col gap-0.5">
                        <input
                          value={row.name}
                          onChange={(e) => updateName(row.id, e.target.value)}
                          placeholder="Service name"
                          className={cn(
                            'w-full bg-transparent border-b text-sm focus:outline-none py-0.5 transition-colors',
                            row.error === 'Missing name'
                              ? 'border-red-300 text-red-700 placeholder:text-red-300'
                              : 'border-transparent hover:border-stone-200 focus:border-[#8B2E4A] text-stone-800'
                          )}
                        />
                        <div className="relative self-start">
                          <select
                            value={row.pricingType ?? 'fixed'}
                            onChange={(e) => updatePricingType(row.id, e.target.value)}
                            title="Change pricing type"
                            className={cn(
                              'text-[10px] font-semibold rounded-md pl-1.5 pr-4 py-0.5 cursor-pointer border-0 focus:outline-none focus:ring-1 focus:ring-[#8B2E4A]/30 appearance-none',
                              !row.pricingType || row.pricingType === 'fixed'
                                ? 'bg-stone-100 text-stone-500'
                                : row.pricingType === 'per_unit'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : row.pricingType === 'addon'
                                    ? 'bg-amber-50 text-amber-700'
                                    : row.pricingType === 'tiered'
                                      ? 'bg-purple-50 text-purple-700'
                                      : 'bg-blue-50 text-blue-700'
                            )}
                          >
                            <option value="fixed">Fixed price</option>
                            <option value="per_unit">Per unit (each)</option>
                            <option value="addon">+ Add-on</option>
                            <option value="tiered">Tiered</option>
                            <option value="multi_option">Options</option>
                          </select>
                          <svg
                            className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-50"
                            width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </div>
                      </div>
                      <div className="col-span-2">
                        {row.pricingType === 'addon' ? (
                          <div className="relative">
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-amber-500 text-sm font-medium">+$</span>
                            <input
                              type="number"
                              value={((row.addonAmountCents ?? 0) / 100).toFixed(2)}
                              onChange={(e) => updateAddonAmount(row.id, e.target.value)}
                              step="0.01"
                              min="0"
                              placeholder="0.00"
                              className="w-full bg-transparent border-b border-transparent hover:border-stone-200 focus:border-[#8B2E4A] text-sm text-amber-700 focus:outline-none py-0.5 pl-6 transition-colors"
                            />
                          </div>
                        ) : (
                          <div className="relative">
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                            <input
                              type="number"
                              value={(row.priceCents / 100).toFixed(2)}
                              onChange={(e) => updatePrice(row.id, e.target.value)}
                              step="0.01"
                              min="0"
                              className={cn(
                                'w-full bg-transparent border-b text-sm focus:outline-none py-0.5 pl-3 transition-colors',
                                row.error === 'Price is $0'
                                  ? 'border-orange-300 text-orange-700'
                                  : 'border-transparent hover:border-stone-200 focus:border-[#8B2E4A] text-stone-800'
                              )}
                            />
                          </div>
                        )}
                      </div>
                      <div className="col-span-2">
                        <select
                          value={row.durationMinutes}
                          onChange={(e) => updateDuration(row.id, parseInt(e.target.value))}
                          className="w-full bg-transparent border-b border-transparent hover:border-stone-200 focus:border-[#8B2E4A] text-sm text-stone-600 focus:outline-none py-0.5 transition-colors"
                        >
                          {DURATION_OPTIONS.map((d) => (
                            <option key={d} value={d}>{d} min</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <input
                          type="color"
                          value={row.color}
                          onChange={(e) => updateColor(row.id, e.target.value)}
                          className="w-6 h-6 rounded-full border border-stone-200 cursor-pointer p-0 overflow-hidden"
                          style={{ WebkitAppearance: 'none' }}
                        />
                      </div>
                      <div className="col-span-2">
                        {row.error === 'Missing name' ? (
                          <span className="text-xs text-red-600 font-medium">Missing name</span>
                        ) : row.error === 'Price is $0' ? (
                          <span className="text-xs text-orange-600 font-medium">$0 price</span>
                        ) : row.include ? (
                          <span className="text-xs text-green-600 font-medium">Import</span>
                        ) : (
                          <span className="text-xs text-stone-400">Skip</span>
                        )}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-sm text-stone-500">
              <span className="font-semibold text-stone-900">{selectedCount}</span> service{selectedCount !== 1 ? 's' : ''} will be imported
            </p>
            <button
              onClick={handleImport}
              disabled={selectedCount === 0}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 active:scale-95"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              Import {selectedCount > 0 ? selectedCount : ''} service{selectedCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Preview (Update mode) ── */}
      {step === 'preview' && mode === 'update' && (
        <div className="space-y-4">
          {importError && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {importError}
            </div>
          )}

          {/* Summary bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-stone-500">
              <span>
                <span className="font-semibold text-stone-900">{rows.length}</span> items from{' '}
                <span className="font-mono text-xs text-stone-600">{fileName}</span>
              </span>
              {updateNoMatchCount > 0 && (
                <span className="text-stone-400 text-xs font-medium">
                  {updateNoMatchCount} not matched
                </span>
              )}
            </div>
            <button
              onClick={() => setStep('upload')}
              className="text-xs text-stone-400 hover:text-stone-600 underline underline-offset-2"
            >
              Change file
            </button>
          </div>

          {updateNoMatchCount > 0 && (
            <div className="rounded-xl bg-stone-50 border border-stone-200 px-4 py-2.5 text-xs text-stone-500">
              {updateNoMatchCount} item{updateNoMatchCount !== 1 ? 's' : ''} on this sheet
              {updateNoMatchCount !== 1 ? ' aren’t' : ' isn’t'} in your services yet — pick a match below,
              or switch to <button onClick={() => { setMode('add'); setStep('upload') }} className="font-semibold text-[#8B2E4A] underline underline-offset-2">Add new services</button> to create them.
            </div>
          )}

          {/* Update table */}
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 bg-stone-50 border-b border-stone-100 text-xs font-semibold text-stone-500 uppercase tracking-wide">
              <div className="col-span-1 flex items-center">
                <input
                  type="checkbox"
                  checked={updateRows.some((r) => r.matchId) && updateRows.filter((r) => r.matchId).every((r) => r.apply)}
                  onChange={toggleAllApply}
                  className="rounded accent-[#8B2E4A] w-3.5 h-3.5"
                />
              </div>
              <div className="col-span-5">Service to update</div>
              <div className="col-span-2">Current</div>
              <div className="col-span-2">New</div>
              <div className="col-span-2">Change</div>
            </div>

            <div className="divide-y divide-stone-50 max-h-[460px] overflow-y-auto">
              {updateRows.map((r) => {
                const ex = r.matchId ? existingById.get(r.matchId) : null
                const oldCents = ex ? existingAmount(ex) : null
                const delta = oldCents != null ? r.newCents - oldCents : null
                const changed = delta != null && delta !== 0
                return (
                  <div
                    key={r.rowId}
                    className={cn(
                      'grid grid-cols-12 gap-2 px-4 py-2.5 items-center text-sm transition-colors',
                      !r.matchId && 'bg-stone-50/40',
                      r.matchId && !r.apply && 'opacity-50'
                    )}
                  >
                    <div className="col-span-1">
                      <input
                        type="checkbox"
                        checked={r.apply}
                        disabled={!r.matchId}
                        onChange={() => toggleApply(r.rowId)}
                        className="rounded accent-[#8B2E4A] w-3.5 h-3.5 disabled:opacity-30"
                      />
                    </div>
                    <div className="col-span-5 flex flex-col gap-0.5 min-w-0">
                      <select
                        value={r.matchId ?? ''}
                        onChange={(e) => setMatch(r.rowId, e.target.value)}
                        className={cn(
                          'w-full bg-transparent border-b text-sm focus:outline-none py-0.5 transition-colors truncate',
                          r.matchId
                            ? 'border-transparent hover:border-stone-200 focus:border-[#8B2E4A] text-stone-800'
                            : 'border-amber-300 text-amber-700'
                        )}
                      >
                        <option value="">— No match (skip) —</option>
                        {sortedExisting.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({dollars(existingAmount(s))})
                          </option>
                        ))}
                      </select>
                      <span className="text-[11px] text-stone-400 truncate">
                        From sheet: {r.scannedName}
                        {r.matchId && r.score < 0.999 && (
                          <span className="ml-1.5 text-stone-300">· {Math.round(r.score * 100)}% match</span>
                        )}
                      </span>
                    </div>
                    <div className="col-span-2 text-stone-500">
                      {oldCents != null ? dollars(oldCents) : '—'}
                    </div>
                    <div className="col-span-2">
                      <div className="relative">
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
                        <input
                          type="number"
                          value={(r.newCents / 100).toFixed(2)}
                          onChange={(e) => setNewPrice(r.rowId, e.target.value)}
                          step="0.01"
                          min="0"
                          disabled={!r.matchId}
                          className="w-full bg-transparent border-b border-transparent hover:border-stone-200 focus:border-[#8B2E4A] text-sm text-stone-800 focus:outline-none py-0.5 pl-3 transition-colors disabled:opacity-40"
                        />
                      </div>
                    </div>
                    <div className="col-span-2">
                      {!r.matchId ? (
                        <span className="text-xs text-stone-400 font-medium">No match</span>
                      ) : !changed ? (
                        <span className="text-xs text-stone-400 font-medium">No change</span>
                      ) : (
                        <span className={cn(
                          'text-xs font-semibold',
                          delta! > 0 ? 'text-emerald-600' : 'text-amber-600'
                        )}>
                          {delta! > 0 ? '↑' : '↓'} {dollars(Math.abs(delta!))}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-sm text-stone-500">
              <span className="font-semibold text-stone-900">{updateSelectedCount}</span> price{updateSelectedCount !== 1 ? 's' : ''} will be updated
            </p>
            <button
              onClick={runUpdate}
              disabled={updateSelectedCount === 0}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 active:scale-95"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              Update {updateSelectedCount > 0 ? updateSelectedCount : ''} price{updateSelectedCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Importing ── */}
      {step === 'importing' && (
        <div className="flex flex-col items-center justify-center py-24 gap-5">
          <div className="w-12 h-12 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin" />
          <div className="text-center">
            <p className="text-sm font-semibold text-stone-700">{mode === 'update' ? 'Updating prices...' : 'Importing services...'}</p>
            <p className="text-xs text-stone-400 mt-1">{importProgress}% complete</p>
          </div>
          <div className="w-48 h-1.5 rounded-full bg-stone-100 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${importProgress}%`, backgroundColor: '#8B2E4A' }}
            />
          </div>
        </div>
      )}

      {/* ── Duplicate Resolution Modal ── */}
      {showDuplicateModal && (
        <div
          style={{
            position: 'fixed', inset: 0,
            backgroundColor: 'rgba(0,0,0,0.3)',
            backdropFilter: 'blur(2px)',
            zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-100 max-w-lg w-full mx-4 animate-in fade-in slide-in-from-bottom-3 duration-200">
            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-stone-100">
              <h2
                className="text-lg font-bold text-stone-900"
                style={{ fontFamily: "'DM Serif Display', serif" }}
              >
                Duplicate Services Found
              </h2>
              <p className="text-sm text-stone-500 mt-0.5">
                {duplicates.length} service{duplicates.length !== 1 ? 's' : ''} already exist. Choose how to handle each.
              </p>
            </div>

            {/* Global actions */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-stone-50 bg-stone-50">
              <span className="text-xs text-stone-500 font-medium flex-1">Apply to all:</span>
              <button
                onClick={() => setDuplicates((prev) => prev.map((d) => ({ ...d, resolution: 'replace' })))}
                className="px-3 py-1 text-xs font-semibold rounded-lg bg-[#8B2E4A] text-white hover:bg-[#72253C] transition-colors"
              >
                Replace All
              </button>
              <button
                onClick={() => setDuplicates((prev) => prev.map((d) => ({ ...d, resolution: 'skip' })))}
                className="px-3 py-1 text-xs font-semibold rounded-lg bg-stone-100 text-stone-700 hover:bg-stone-200 transition-colors"
              >
                Skip All
              </button>
            </div>

            {/* Per-row list */}
            <div className="max-h-64 overflow-y-auto divide-y divide-stone-50">
              {duplicates.map((dup, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-900 truncate">{dup.parsedService.name}</p>
                    <p className="text-xs text-stone-400 mt-0.5">
                      Existing: ${(dup.existingService.priceCents / 100).toFixed(2)}
                      {' '}&rarr;{' '}
                      New: ${(dup.parsedService.priceCents / 100).toFixed(2)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setDuplicates((prev) => prev.map((d, j) => j === i ? { ...d, resolution: 'replace' } : d))}
                      className={cn(
                        'px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors',
                        dup.resolution === 'replace'
                          ? 'bg-[#8B2E4A] text-white'
                          : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                      )}
                    >
                      Replace
                    </button>
                    <button
                      onClick={() => setDuplicates((prev) => prev.map((d, j) => j === i ? { ...d, resolution: 'skip' } : d))}
                      className={cn(
                        'px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors',
                        dup.resolution === 'skip'
                          ? 'bg-stone-700 text-white'
                          : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                      )}
                    >
                      Skip
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-stone-100">
              <button
                onClick={() => { setShowDuplicateModal(false); setDuplicates([]) }}
                className="px-4 py-2 text-sm font-medium text-stone-600 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDuplicateModal(false)
                  const toImport = rows.filter((r) => r.include && r.error !== 'Missing name')
                  runImport(toImport, duplicates)
                }}
                className="px-4 py-2 text-sm font-semibold text-white rounded-xl active:scale-95 transition-all"
                style={{ backgroundColor: '#8B2E4A' }}
              >
                Continue Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PDF parse loading overlay ── */}
      {parsing && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center gap-4 mx-4 w-full max-w-xs">
            <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="1.8">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-stone-800">{mode === 'update' ? 'Reading price sheet...' : 'Importing services...'}</p>
              <p className="text-xs text-stone-400 mt-1">{mode === 'update' ? 'Matching to your services' : 'Analyzing your price sheet'}</p>
            </div>
            <div className="w-full h-1.5 rounded-full bg-stone-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#8B2E4A]"
                style={{
                  width: `${progress}%`,
                  transition: progress === 70 ? 'width 2s cubic-bezier(0.4, 0, 0.2, 1)' : 'width 0.4s ease-out',
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Step: Done ── */}
      {step === 'done' && mode === 'add' && result && (
        <div className="flex flex-col items-center justify-center py-16 gap-6 text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: '#e6faf9' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2.2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <div>
            <h2 className="text-xl font-bold text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Import complete
            </h2>
            <p className="text-sm text-stone-500 mt-1">Your services have been added</p>
          </div>

          <div className="flex gap-4">
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-8 py-5 text-center">
              <p className="text-3xl font-bold text-[#8B2E4A]">{result.created}</p>
              <p className="text-xs text-stone-500 mt-1 font-medium uppercase tracking-wide">Added</p>
            </div>
            {result.skipped > 0 && (
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-8 py-5 text-center">
                <p className="text-3xl font-bold text-stone-400">{result.skipped}</p>
                <p className="text-xs text-stone-500 mt-1 font-medium uppercase tracking-wide">Skipped (already exist)</p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setStep('upload')
                setRows([])
                setResult(null)
                setFileName('')
              }}
              className="px-4 py-2 rounded-xl text-sm font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
            >
              Import another file
            </button>
            <Link
              href="/services"
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 inline-flex items-center"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              View services &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* ── Step: Done (Update mode) ── */}
      {step === 'done' && mode === 'update' && updateResult && (
        <div className="flex flex-col items-center justify-center py-16 gap-6 text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: '#e6faf9' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2.2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          <div>
            <h2 className="text-xl font-bold text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>
              Prices updated
            </h2>
            <p className="text-sm text-stone-500 mt-1">Your service prices have been overwritten</p>
          </div>

          <div className="flex gap-4">
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-8 py-5 text-center">
              <p className="text-3xl font-bold text-[#8B2E4A]">{updateResult.updated}</p>
              <p className="text-xs text-stone-500 mt-1 font-medium uppercase tracking-wide">Updated</p>
            </div>
            {updateResult.skipped > 0 && (
              <div className="bg-white rounded-2xl border border-stone-100 shadow-sm px-8 py-5 text-center">
                <p className="text-3xl font-bold text-stone-400">{updateResult.skipped}</p>
                <p className="text-xs text-stone-500 mt-1 font-medium uppercase tracking-wide">Not matched</p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setStep('upload')
                setRows([])
                setUpdateRows([])
                setUpdateResult(null)
                setExistingServices([])
                setFileName('')
              }}
              className="px-4 py-2 rounded-xl text-sm font-medium text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
            >
              Update from another file
            </button>
            <Link
              href="/services"
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95 inline-flex items-center"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              View services &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
