'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { cn, formatCents } from '@/lib/utils'

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

// ─── PDF parser (server-side) ────────────────────────────────────────────────

async function parsePDF(file: File): Promise<ParsedService[]> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/services/parse-pdf', {
    method: 'POST',
    body: formData,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error ?? 'Failed to parse PDF')
  const rows: Array<{
    name: string; priceCents: number; durationMinutes: number; category: string; color: string
    pricingType?: string; addonAmountCents?: number | null
    pricingTiers?: Array<{ minQty: number; maxQty: number; unitPriceCents: number }> | null
    pricingOptions?: Array<{ name: string; priceCents: number }> | null
  }> = json.data
  if (rows.length === 0) throw new Error('No services found in PDF. Expected lines like "Service Name $25.00".')
  return rows.map((r, i) => ({
    id: i,
    name: r.name,
    priceCents: r.priceCents,
    durationMinutes: r.durationMinutes,
    category: r.category,
    color: r.color,
    include: true,
    pricingType: r.pricingType,
    addonAmountCents: r.addonAmountCents ?? null,
    pricingTiers: r.pricingTiers ?? null,
    pricingOptions: r.pricingOptions ?? null,
  }))
}

// ─── Spreadsheet parser ──────────────────────────────────────────────────────

async function parseSpreadsheet(file: File): Promise<ParsedService[]> {
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

async function parseFile(file: File): Promise<ParsedService[]> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') {
    return parsePDF(file)
  }
  return parseSpreadsheet(file)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportClient() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  const selectedCount = rows.filter((r) => r.include && r.error !== 'Missing name').length
  const errorCount = rows.filter((r) => r.error === 'Missing name').length

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    setParseError(null)
    setFileName(file.name)
    try {
      const parsed = await parseFile(file)
      setRows(parsed)
      setStep('preview')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file')
    }
  }, [])

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
      r.id === id ? { ...r, name, error: name.trim() ? (r.priceCents === 0 ? 'Price is $0' : undefined) : 'Missing name' } : r
    ))

  const updatePrice = (id: number, dollars: string) => {
    const cents = parsePriceToCents(dollars)
    setRows((prev) => prev.map((r) =>
      r.id === id ? { ...r, priceCents: cents, error: r.name.trim() ? (cents === 0 ? 'Price is $0' : undefined) : 'Missing name' } : r
    ))
  }

  const updateDuration = (id: number, minutes: number) =>
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, durationMinutes: minutes } : r))

  const updateColor = (id: number, color: string) =>
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, color } : r))

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
      // Handle replacements via individual PUT to existing service
      for (const dup of replaceRows) {
        await fetch(`/api/services/${dup.existingService.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            priceCents: dup.parsedService.priceCents,
            durationMinutes: dup.parsedService.durationMinutes,
            color: dup.parsedService.color,
          }),
        })
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
              priceCents: r.pricingType === 'addon' ? 0 : r.priceCents,
              durationMinutes: r.durationMinutes,
              color: r.color,
              pricingType: r.pricingType,
              addonAmountCents: r.addonAmountCents ?? null,
              pricingTiers: r.pricingTiers ?? null,
              pricingOptions: r.pricingOptions ?? null,
              category: r.category ?? null,
            })),
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Import failed')
        totalCreated += json.data.created
        totalSkipped += json.data.skipped
        setImportProgress(Math.round(((i + chunk.length) / Math.max(newRows.length, 1)) * 100))
      }

      setResult({ created: totalCreated, skipped: totalSkipped + skipNames.size })
      setStep('done')
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
      if (!res.ok) throw new Error(json.error ?? 'Failed to load services')

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
            Import Services
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Upload a price sheet to bulk-add services
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
            <p className="text-xs text-stone-400">Supports .pdf, .csv, .xlsx, .xls</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.csv,.xlsx,.xls,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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

      {/* ── Step: Preview ── */}
      {step === 'preview' && (
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
              <div className="col-span-4">Name</div>
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
                        {row.pricingType === 'addon' && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 self-start">+add-on</span>
                        )}
                        {row.pricingType === 'tiered' && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded-md bg-purple-50 text-purple-700 self-start">tiered</span>
                        )}
                        {row.pricingType === 'multi_option' && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded-md bg-blue-50 text-blue-700 self-start">options</span>
                        )}
                      </div>
                      <div className="col-span-2">
                        {row.pricingType === 'addon' && (row.addonAmountCents ?? 0) > 0 ? (
                          <span className="text-sm font-medium text-amber-700 pl-1">
                            +{formatCents(row.addonAmountCents ?? 0)}
                          </span>
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

      {/* ── Step: Importing ── */}
      {step === 'importing' && (
        <div className="flex flex-col items-center justify-center py-24 gap-5">
          <div className="w-12 h-12 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin" />
          <div className="text-center">
            <p className="text-sm font-semibold text-stone-700">Importing services...</p>
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

      {/* ── Step: Done ── */}
      {step === 'done' && result && (
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
    </div>
  )
}
