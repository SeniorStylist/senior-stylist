import { isPerUnitService } from '@/lib/pricing'

// Shared client-side price-sheet parser used by both the single-facility import
// (/services/import) and the master bulk tool (/master-admin/imports/price-sheets).
// All formats funnel through the same AI parser: PDFs/images go to Gemini as
// inlineData; spreadsheets and Word docs are converted to a tab-separated grid
// first. Returns the pricing data only — UI concerns (row id / include / error)
// are added by each caller.

export interface ParsedPriceRow {
  name: string
  priceCents: number
  durationMinutes: number
  category: string
  color: string
  pricingType: string // 'fixed' | 'per_unit' | 'addon' | 'tiered' | 'multi_option'
  addonAmountCents: number | null
  pricingTiers: Array<{ minQty: number; maxQty: number; unitPriceCents: number }> | null
  pricingOptions: Array<{ name: string; priceCents: number }> | null
}

const COLORS = ['#0D7377', '#E57373', '#FFB74D', '#81C784', '#64B5F6', '#BA68C8', '#4DB6AC', '#FF8A65']
const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120]

function normalize(s: string) {
  return s.toLowerCase().replace(/[\s_\-#.]/g, '')
}
const NAME_HEADERS = new Set(['name', 'service', 'servicename', 'description', 'item'])
const PRICE_HEADERS = new Set(['price', 'cost', 'amount', 'rate', 'charge', 'fee'])
const DURATION_HEADERS = new Set(['duration', 'time', 'minutes', 'mins', 'min', 'length'])

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
  if (nameIdx === -1) nameIdx = 0
  return { nameIdx, priceIdx, durationIdx }
}

export function parsePriceToCents(value: string | number): number {
  if (typeof value === 'number') return Math.round(value * 100)
  const cleaned = String(value).replace(/[^0-9.]/g, '')
  const num = parseFloat(cleaned)
  if (isNaN(num)) return 0
  return Math.round(num * 100)
}

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

async function parseExcel(file: File): Promise<string[][]> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

function rowsToTsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => String(c ?? '').trim()).join('\t')).join('\n')
}

async function spreadsheetToGridText(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'csv' || ext === 'txt') return rowsToTsv(await parseCSV(file))
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

async function docxToGridText(file: File): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const docXml = zip.file('word/document.xml')
  if (!docXml) throw new Error("This doesn't look like a Word document.")
  const xml = await docXml.async('string')
  const unescape = (s: string) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

  const lines: string[] = []
  const blocks = xml.match(/<w:tr\b[\s\S]*?<\/w:tr>|<w:p\b[\s\S]*?<\/w:p>/g) ?? []
  for (const b of blocks) {
    if (b.startsWith('<w:tr')) {
      const cells = (b.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map((c) =>
        (c.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
          .map((t) => unescape(t.replace(/<[^>]+>/g, '')))
          .join('')
          .trim()
      )
      if (cells.some(Boolean)) lines.push(cells.join('\t'))
    } else {
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

type AIParseResult = { rows: ParsedPriceRow[]; detectedFacilityName: string | null }

async function postToAIParser(formData: FormData): Promise<AIParseResult> {
  const res = await fetch('/api/services/parse-pdf', { method: 'POST', body: formData })
  // Read as text first: a platform failure (timeout / crash / auth redirect to the
  // HTML /login page) returns HTML, not JSON, which would throw a cryptic
  // "Unexpected token '<'" on res.json(). Surface the real reason instead.
  const raw = await res.text()
  let json: { data?: unknown; error?: unknown } | null = null
  try { json = JSON.parse(raw) } catch { /* non-JSON (HTML error page) */ }
  if (!json) {
    const reason =
      res.status === 401 || res.status === 403
        ? "Your session expired or you don't have access. Refresh the page, sign in again, and retry."
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
  // Route now returns { facilityName, rows } — handle both old (bare array) and new shape.
  const data = json.data
  const rawRows: Array<{
    name: string; priceCents: number; durationMinutes: number; category: string; color: string
    pricingType?: string; addonAmountCents?: number | null
    pricingTiers?: Array<{ minQty: number; maxQty: number; unitPriceCents: number }> | null
    pricingOptions?: Array<{ name: string; priceCents: number }> | null
  }> = Array.isArray(data) ? data : ((data as { rows?: unknown })?.rows as typeof rawRows ?? [])
  const detectedFacilityName = (!Array.isArray(data) && data && typeof (data as { facilityName?: unknown }).facilityName === 'string')
    ? ((data as { facilityName: string }).facilityName.trim() || null)
    : null
  const rows = rawRows.map((r) => {
    // A single open-ended tier ("$8 ea") is a flat per-unit price — normalize to the
    // 'per_unit' marker with the unit price in priceCents so the review shows "$8 each".
    const perUnit = isPerUnitService({ pricingType: r.pricingType ?? 'fixed', pricingTiers: r.pricingTiers ?? null })
    return {
      name: r.name,
      priceCents: perUnit ? (r.pricingTiers?.[0]?.unitPriceCents ?? r.priceCents) : r.priceCents,
      durationMinutes: r.durationMinutes,
      category: r.category,
      color: r.color,
      pricingType: perUnit ? 'per_unit' : (r.pricingType ?? 'fixed'),
      addonAmountCents: r.addonAmountCents ?? null,
      pricingTiers: perUnit ? null : (r.pricingTiers ?? null),
      pricingOptions: r.pricingOptions ?? null,
    }
  })
  return { rows, detectedFacilityName }
}

async function parseFileViaVision(file: File): Promise<AIParseResult> {
  const formData = new FormData()
  formData.append('file', file)
  const result = await postToAIParser(formData)
  if (result.rows.length === 0) throw new Error('No services found in this file. Make sure it lists service names with prices.')
  return result
}

async function parseGridTextAI(file: File): Promise<AIParseResult> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const gridText = ext === 'docx' ? await docxToGridText(file) : await spreadsheetToGridText(file)
  if (!gridText.trim()) throw new Error('File appears to be empty.')
  const formData = new FormData()
  formData.append('gridText', gridText)
  return postToAIParser(formData)
}

async function parseSpreadsheetNaive(file: File): Promise<ParsedPriceRow[]> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const rows = ext === 'csv' || ext === 'txt' ? await parseCSV(file) : await parseExcel(file)
  if (rows.length < 2) throw new Error('File appears to be empty or has only a header row.')
  const headers = rows[0].map(String)
  const { nameIdx, priceIdx, durationIdx } = detectColumns(headers)
  return rows.slice(1).map((row, i) => {
    const durationMinutes = durationIdx >= 0 ? (parseInt(String(row[durationIdx])) || 30) : 30
    return {
      name: String(row[nameIdx] ?? '').trim(),
      priceCents: priceIdx >= 0 ? parsePriceToCents(row[priceIdx]) : 0,
      durationMinutes: DURATION_OPTIONS.includes(durationMinutes) ? durationMinutes : 30,
      color: COLORS[i % COLORS.length],
      category: '',
      pricingType: 'fixed',
      addonAmountCents: null,
      pricingTiers: null,
      pricingOptions: null,
    }
  })
}

// Only a sheet with a REAL header row (recognized name + price columns) is safe for
// the naive column-mapper. Free-form price sheets must never hit it — it turns
// every section header / prose line into a garbage service.
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

export const VISION_EXTS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif'])
export const SUPPORTED_EXTS = new Set([...VISION_EXTS, 'docx', 'csv', 'xlsx', 'xls', 'txt'])

export type ParseResult = { rows: ParsedPriceRow[]; detectedFacilityName: string | null }

export async function parsePriceSheetFile(file: File): Promise<ParseResult> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext && VISION_EXTS.has(ext)) return parseFileViaVision(file)
  if (ext === 'docx') {
    const result = await parseGridTextAI(file)
    if (result.rows.length > 0) return result
    throw new Error('No services could be read from this document. Make sure it lists service names with prices.')
  }
  try {
    const result = await parseGridTextAI(file)
    if (result.rows.length > 0) return result
    throw new Error('No services could be read from this sheet. Make sure it lists service names with prices.')
  } catch (err) {
    if (await looksTabular(file)) return { rows: await parseSpreadsheetNaive(file), detectedFacilityName: null }
    throw err instanceof Error ? err : new Error('Could not read this price sheet. Please try again.')
  }
}
