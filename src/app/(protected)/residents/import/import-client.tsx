'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedRow {
  id: number
  name: string
  roomNumber: string
  include: boolean
  error?: string
}

type Step = 'upload' | 'preview' | 'importing' | 'done'

interface DoneResult {
  created: number
  skipped: number
}

// ─── Column detection ─────────────────────────────────────────────────────────

function normalize(s: string) {
  return s.toLowerCase().replace(/[\s_\-#.]/g, '')
}

const NAME_HEADERS = new Set([
  'name', 'residentname', 'fullname', 'resident', 'firstname+lastname',
  'patientname', 'clientname',
])
const ROOM_HEADERS = new Set([
  'room', 'roomnumber', 'roomno', 'roomnum', 'unit', 'unitnumber',
  'apt', 'apartment', 'suite', 'bed', 'bednumber',
])

function detectColumns(headers: string[]): { nameIdx: number; roomIdx: number } {
  let nameIdx = -1
  let roomIdx = -1
  headers.forEach((h, i) => {
    const n = normalize(h)
    if (nameIdx === -1 && NAME_HEADERS.has(n)) nameIdx = i
    if (roomIdx === -1 && ROOM_HEADERS.has(n)) roomIdx = i
  })
  // Fallback: first column is name, second is room
  if (nameIdx === -1) nameIdx = 0
  return { nameIdx, roomIdx }
}

// ─── CSV parser (papaparse) ────────────────────────────────────────────────────

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

// ─── Excel parser (xlsx) ──────────────────────────────────────────────────────

async function parseExcel(file: File): Promise<string[][]> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''))
}

// ─── Main parser ──────────────────────────────────────────────────────────────

async function parseFile(file: File): Promise<ParsedRow[]> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  let rows: string[][]

  if (ext === 'csv' || ext === 'txt') {
    rows = await parseCSV(file)
  } else if (ext === 'xlsx' || ext === 'xls') {
    rows = await parseExcel(file)
  } else {
    throw new Error('Unsupported file type. Please upload a .csv, .xlsx, or .xls file.')
  }

  if (rows.length < 2) throw new Error('File appears to be empty or has only a header row.')

  const headers = rows[0].map(String)
  const { nameIdx, roomIdx } = detectColumns(headers)
  const dataRows = rows.slice(1)

  return dataRows.map((row, i) => {
    const name = String(row[nameIdx] ?? '').trim()
    const roomNumber = roomIdx >= 0 ? String(row[roomIdx] ?? '').trim() : ''
    return {
      id: i,
      name,
      roomNumber,
      include: name.length > 0,
      error: name.length === 0 ? 'Missing name' : undefined,
    }
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportClient() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [dragging, setDragging] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [importProgress, setImportProgress] = useState(0)
  const [result, setResult] = useState<DoneResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const selectedCount = rows.filter((r) => r.include && !r.error).length
  const errorCount = rows.filter((r) => r.error).length

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
      r.id === id ? { ...r, name, error: name.trim() ? undefined : 'Missing name' } : r
    ))

  const updateRoom = (id: number, roomNumber: string) =>
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, roomNumber } : r))

  const toggleAll = () => {
    const anyOn = rows.some((r) => r.include && !r.error)
    setRows((prev) => prev.map((r) => ({ ...r, include: r.error ? false : !anyOn })))
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  const handleImport = async () => {
    const toImport = rows.filter((r) => r.include && !r.error)
    if (toImport.length === 0) return

    setStep('importing')
    setImportProgress(0)
    setImportError(null)

    // Chunk into batches of 100 to avoid request body size limits
    const BATCH = 100
    let totalCreated = 0
    let totalSkipped = 0

    try {
      for (let i = 0; i < toImport.length; i += BATCH) {
        const chunk = toImport.slice(i, i + BATCH)
        const res = await fetch('/api/residents/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: chunk.map((r) => ({
              name: r.name.trim(),
              roomNumber: r.roomNumber.trim() || undefined,
            })),
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Import failed')
        totalCreated += json.data.created
        totalSkipped += json.data.skipped
        setImportProgress(Math.round(((i + chunk.length) / toImport.length) * 100))
      }

      setResult({ created: totalCreated, skipped: totalSkipped })
      setStep('done')
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed')
      setStep('preview')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page-enter p-6 md:p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => (step === 'preview' ? setStep('upload') : router.push('/residents'))}
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
            Import Residents
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            Upload a spreadsheet to bulk-add residents
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
                {dragging ? 'Drop to upload' : 'Drop your file here'}
              </p>
              <p className="text-xs text-stone-400 mt-0.5">or click to browse</p>
            </div>
            <p className="text-xs text-stone-400">Supports .csv, .xlsx, .xls</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
                    {['Name', 'Room', '(other columns ignored)'].map((h) => (
                      <th key={h} className="text-left font-semibold text-stone-700 border border-stone-200 px-3 py-1.5 bg-stone-100">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Eleanor Vance', '101', ''],
                    ['Harold Bishop', '204', ''],
                    ['Margaret Chen', '315', ''],
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
              Column headers are detected automatically. Accepted header names: <em>Name, Resident, Full Name</em> and <em>Room, Room Number, Unit</em>.
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
            <div className="grid grid-cols-12 gap-3 px-4 py-2.5 bg-stone-50 border-b border-stone-100 text-xs font-semibold text-stone-500 uppercase tracking-wide">
              <div className="col-span-1 flex items-center">
                <input
                  type="checkbox"
                  checked={rows.filter((r) => !r.error).every((r) => r.include)}
                  onChange={toggleAll}
                  className="rounded accent-[#8B2E4A] w-3.5 h-3.5"
                />
              </div>
              <div className="col-span-5">Name</div>
              <div className="col-span-4">Room</div>
              <div className="col-span-2">Status</div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-stone-50 max-h-[420px] overflow-y-auto">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    'grid grid-cols-12 gap-3 px-4 py-2.5 items-center text-sm transition-colors',
                    !row.include && 'opacity-40',
                    row.error && 'bg-orange-50/50'
                  )}
                >
                  <div className="col-span-1">
                    <input
                      type="checkbox"
                      checked={row.include}
                      disabled={!!row.error}
                      onChange={() => toggleRow(row.id)}
                      className="rounded accent-[#8B2E4A] w-3.5 h-3.5"
                    />
                  </div>
                  <div className="col-span-5">
                    <input
                      value={row.name}
                      onChange={(e) => updateName(row.id, e.target.value)}
                      placeholder="Full name"
                      className={cn(
                        'w-full bg-transparent border-b text-sm focus:outline-none py-0.5 transition-colors',
                        row.error
                          ? 'border-orange-300 text-orange-700 placeholder:text-orange-300'
                          : 'border-transparent hover:border-stone-200 focus:border-[#8B2E4A] text-stone-800'
                      )}
                    />
                  </div>
                  <div className="col-span-4">
                    <input
                      value={row.roomNumber}
                      onChange={(e) => updateRoom(row.id, e.target.value)}
                      placeholder="—"
                      className="w-full bg-transparent border-b border-transparent hover:border-stone-200 focus:border-[#8B2E4A] text-sm text-stone-600 focus:outline-none py-0.5 transition-colors"
                    />
                  </div>
                  <div className="col-span-2">
                    {row.error ? (
                      <span className="text-xs text-orange-600 font-medium">{row.error}</span>
                    ) : row.include ? (
                      <span className="text-xs text-green-600 font-medium">Import</span>
                    ) : (
                      <span className="text-xs text-stone-400">Skip</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-sm text-stone-500">
              <span className="font-semibold text-stone-900">{selectedCount}</span> resident{selectedCount !== 1 ? 's' : ''} will be imported
            </p>
            <button
              onClick={handleImport}
              disabled={selectedCount === 0}
              className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 active:scale-95"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              Import {selectedCount > 0 ? selectedCount : ''} resident{selectedCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* ── Step: Importing ── */}
      {step === 'importing' && (
        <div className="flex flex-col items-center justify-center py-24 gap-5">
          <div className="w-12 h-12 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin" />
          <div className="text-center">
            <p className="text-sm font-semibold text-stone-700">Importing residents…</p>
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
            <p className="text-sm text-stone-500 mt-1">Your residents have been added</p>
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
            <button
              onClick={() => router.push('/residents')}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all active:scale-95"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              View residents →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
