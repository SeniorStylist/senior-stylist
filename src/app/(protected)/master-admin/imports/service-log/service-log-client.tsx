'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const SpreadsheetIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2a4 4 0 014-4h6m-6 0V7a4 4 0 00-4-4H5a2 2 0 00-2 2v14a2 2 0 002 2h6m4-6h4m0 0l-2-2m2 2l-2 2" />
  </svg>
)
const AlertIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
)
const CheckIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
)

interface ImportResult {
  batchId: string
  residentsUpserted: number
  bookingsCreated: number
  duplicatesSkipped: number
  servicesMatched: number
  unresolvedCount: number
  qbInvoicesLinked: number
}

interface StylistResolution {
  stylistResolutionNeeded: true
  stylistName: string
  stylistCode: string | null
  facilityId: string
}

type ApiResponse = ImportResult | StylistResolution

type State = 'upload' | 'preview' | 'loading' | 'stylist-resolution' | 'results'

interface PreviewData {
  facility: string
  stylist: string
  stylistCode: string | null
  rowCount: number
}

export function ServiceLogClient() {
  const [state, setState] = useState<State>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [stylistResolution, setStylistResolution] = useState<StylistResolution | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creatingStylist, setCreatingStylist] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelect(f: File) {
    setError(null)
    setFile(f)
    try {
      const XLSX = await import('xlsx')
      const buffer = await f.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })

      let facility = ''
      let stylistRaw = ''
      let usableRows = 0
      for (const r of rows) {
        if (!facility) {
          const f = String(r['Facility'] ?? '').trim()
          if (f) facility = f
        }
        if (!stylistRaw) {
          const s = String(r['Stylist'] ?? '').trim()
          if (s) stylistRaw = s
        }
        const client = String(r['Client Name'] ?? '').trim().toLowerCase()
        if (client && client !== "doesn't fill") usableRows += 1
      }

      const stylistMatch = stylistRaw.match(/^([A-Z]{2,4}\d{2,5})\s*-\s*(.+)$/)
      const stylistCode = stylistMatch ? stylistMatch[1] : null
      const stylistName = stylistMatch ? stylistMatch[2].trim() : stylistRaw

      setPreview({ facility, stylist: stylistName, stylistCode, rowCount: usableRows })
      setState('preview')
    } catch (err) {
      setError(`Could not parse file: ${(err as Error).message}`)
    }
  }

  async function uploadFile(currentFile: File) {
    setError(null)
    setState('loading')
    setProgress(0)
    setTimeout(() => setProgress(70), 50)
    try {
      const formData = new FormData()
      formData.append('file', currentFile)
      const res = await fetch('/api/super-admin/import-service-log', {
        method: 'POST',
        body: formData,
      })
      const text = await res.text().catch(() => '')
      let json: { data?: ApiResponse; error?: string; facilityName?: string } = {}
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error(text.slice(0, 200) || `Server error (${res.status})`)
      }
      if (!res.ok) {
        if (json.error === 'facility_not_found') {
          throw new Error(`Facility "${json.facilityName ?? 'unknown'}" was not found in Senior Stylist. Add it to the system first, then retry.`)
        }
        throw new Error(json.error ?? 'Import failed')
      }

      setProgress(100)
      await new Promise((r) => setTimeout(r, 400))

      const data = json.data
      if (data && 'stylistResolutionNeeded' in data) {
        setStylistResolution(data)
        setState('stylist-resolution')
      } else if (data) {
        setResult(data as ImportResult)
        setState('results')
      } else {
        throw new Error('No data in response')
      }
    } catch (err) {
      setProgress(100)
      await new Promise((r) => setTimeout(r, 200))
      setError((err as Error).message)
      setState('preview')
    }
  }

  async function handleCreateStylistAndRetry() {
    if (!stylistResolution || !file) return
    setCreatingStylist(true)
    try {
      // Create stylist as franchise pool member (no facilityId).
      const res = await fetch('/api/stylists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: stylistResolution.stylistName,
          stylistCode: stylistResolution.stylistCode ?? `IMPORT-${Date.now()}`,
          facilityId: stylistResolution.facilityId,
          color: '#8B2E4A',
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Failed to create stylist: ${text.slice(0, 200)}`)
      }
      // Re-upload — server will now match the new stylist.
      setStylistResolution(null)
      await uploadFile(file)
    } catch (err) {
      setError((err as Error).message)
      setState('preview')
    } finally {
      setCreatingStylist(false)
    }
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setStylistResolution(null)
    setResult(null)
    setError(null)
    setProgress(0)
    setState('upload')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="page-enter min-h-screen bg-stone-50 p-6">
      {/* Loading overlay */}
      {state === 'loading' && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm mx-4">
            <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-4">
              <SpreadsheetIcon className="w-6 h-6 text-[#8B2E4A]" />
            </div>
            <h3 className="text-base font-semibold text-stone-900 text-center mb-1">
              Importing service log…
            </h3>
            <p className="text-sm text-stone-500 text-center mb-5">
              Matching residents, services, and QuickBooks invoices
            </p>
            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#8B2E4A] rounded-full"
                style={{
                  width: `${progress}%`,
                  transition:
                    progress === 70
                      ? 'width 3s cubic-bezier(0.4, 0, 0.2, 1)'
                      : 'width 0.4s ease-out',
                }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto">
        <Link
          href="/master-admin/imports"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 mb-6"
        >
          <span>←</span> Back to Imports
        </Link>

        {/* Step 1 — upload */}
        {state === 'upload' && (
          <div className="bg-white rounded-2xl border border-stone-200 p-8">
            <h1
              className="text-2xl font-normal mb-2"
              style={{ fontFamily: "'DM Serif Display', serif", color: '#8B2E4A' }}
            >
              Service Log Import
            </h1>
            <p className="text-sm text-stone-500 mb-8">
              Upload a bookkeeper XLSX file. We&apos;ll auto-detect the facility and stylist, match
              residents and services, and link payments to QuickBooks invoices.
            </p>

            {error && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                {error}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFileSelect(f)
              }}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const f = e.dataTransfer.files?.[0]
                if (f && f.name.toLowerCase().endsWith('.xlsx')) handleFileSelect(f)
              }}
              className="border-2 border-dashed border-stone-200 rounded-xl p-10 text-center cursor-pointer hover:border-[#8B2E4A] hover:bg-rose-50/30 transition-colors"
            >
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-3">
                <SpreadsheetIcon className="w-5 h-5 text-stone-400" />
              </div>
              <p className="text-sm font-medium text-stone-600">Click to select XLSX file</p>
              <p className="text-xs text-stone-400 mt-1">or drag and drop</p>
            </div>
          </div>
        )}

        {/* Step 2 — preview */}
        {state === 'preview' && preview && file && (
          <div className="bg-white rounded-2xl border border-stone-200 p-8">
            <h1
              className="text-2xl font-normal mb-2"
              style={{ fontFamily: "'DM Serif Display', serif", color: '#8B2E4A' }}
            >
              Confirm Import
            </h1>
            <p className="text-sm text-stone-500 mb-6">{file.name}</p>

            {error && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between px-4 py-3 bg-stone-50 rounded-xl">
                <span className="text-sm font-medium text-stone-700">Rows detected</span>
                <span className="text-sm font-semibold text-stone-900">{preview.rowCount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 bg-stone-50 rounded-xl">
                <span className="text-sm font-medium text-stone-700">Facility</span>
                <span className="text-sm font-semibold text-stone-900">{preview.facility || '—'}</span>
              </div>
              <div className="flex items-center justify-between px-4 py-3 bg-stone-50 rounded-xl">
                <span className="text-sm font-medium text-stone-700">Stylist</span>
                <span className="text-sm font-semibold text-stone-900">
                  {preview.stylistCode && (
                    <span className="text-stone-400 font-mono mr-2">{preview.stylistCode}</span>
                  )}
                  {preview.stylist || '—'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={reset}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => uploadFile(file)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors"
                style={{ backgroundColor: '#8B2E4A' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#72253C' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#8B2E4A' }}
              >
                Proceed to import →
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — stylist resolution */}
        {state === 'stylist-resolution' && stylistResolution && (
          <div className="bg-white rounded-2xl border border-stone-200 p-8">
            <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center mb-4">
              <AlertIcon className="w-5 h-5 text-amber-600" />
            </div>
            <h2 className="text-lg font-semibold text-stone-900 mb-2">Stylist not found</h2>
            <p className="text-sm text-stone-500 mb-6">
              <span className="font-semibold text-stone-700">{stylistResolution.stylistName}</span>
              {stylistResolution.stylistCode && (
                <span className="text-stone-400 font-mono ml-1">({stylistResolution.stylistCode})</span>
              )}
              {' '}was not found in the database. Create them as a new stylist and we&apos;ll retry the
              import automatically.
            </p>

            {error && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={reset}
                disabled={creatingStylist}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateStylistAndRetry}
                disabled={creatingStylist}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: '#8B2E4A' }}
              >
                {creatingStylist ? 'Creating…' : 'Create stylist and retry'}
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — results */}
        {state === 'results' && result && (
          <div className="bg-white rounded-2xl border border-stone-200 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckIcon className="w-5 h-5 text-emerald-600" />
              </div>
              <h2 className="text-lg font-semibold text-stone-900">Import complete</h2>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <ResultTile
                label="Bookings created"
                value={result.bookingsCreated}
                accent="emerald"
                href="/dashboard"
              />
              <ResultTile
                label="Residents upserted"
                value={result.residentsUpserted}
                accent="stone"
                tooltip="New residents were auto-created from names in the import file."
              />
              <ResultTile
                label="Services matched"
                value={result.servicesMatched}
                accent="stone"
                tooltip="Line items matched to a service in the catalog by name, price, or combination."
              />
              <ResultTile
                label="Need review"
                value={result.unresolvedCount}
                accent={result.unresolvedCount > 0 ? 'amber' : 'stone'}
                href={result.unresolvedCount > 0 ? '/master-admin/imports?tab=review' : undefined}
                tooltip={result.unresolvedCount === 0 ? 'All line items were matched — nothing needs manual review.' : undefined}
              />
              <ResultTile
                label="QB invoices linked"
                value={result.qbInvoicesLinked}
                accent="stone"
                href={result.qbInvoicesLinked > 0 ? '/billing' : undefined}
                tooltip={result.qbInvoicesLinked === 0 ? 'No QB invoices were cross-referenced to these bookings.' : undefined}
              />
              <ResultTile
                label="Duplicates skipped"
                value={result.duplicatesSkipped}
                accent="stone"
                tooltip="Rows already in the database were skipped to prevent double-counting."
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={reset}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors"
              >
                Import another file
              </button>
              <Link
                href="/master-admin/imports"
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white text-center transition-colors"
                style={{ backgroundColor: '#8B2E4A' }}
              >
                Back to Imports →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ResultTile({
  label,
  value,
  accent,
  href,
  tooltip,
}: {
  label: string
  value: number
  accent: 'emerald' | 'amber' | 'stone'
  href?: string
  tooltip?: string
}) {
  const router = useRouter()
  const [showTooltip, setShowTooltip] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showTooltip) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowTooltip(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTooltip])

  const valueColor =
    accent === 'emerald'
      ? 'text-emerald-700'
      : accent === 'amber'
        ? 'text-amber-700'
        : 'text-stone-900'

  const isClickable = !!(href || tooltip)

  const inner = (
    <>
      <p className="text-xs text-stone-500 mb-1">{label}</p>
      <p className={`text-xl font-semibold ${valueColor}`}>{value.toLocaleString()}</p>
    </>
  )

  if (isClickable) {
    return (
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => {
            if (href) { router.push(href) } else { setShowTooltip((v) => !v) }
          }}
          className="w-full text-left px-4 py-3 bg-stone-50 rounded-xl cursor-pointer transition-[background-color,box-shadow] duration-[120ms] hover:bg-[#F9EFF2] hover:shadow-[0_0_0_1.5px_rgba(139,46,74,0.15)]"
        >
          {inner}
        </button>
        {showTooltip && tooltip && (
          <div className="absolute left-0 top-full mt-1.5 z-10 bg-stone-800 text-white text-xs rounded-xl px-3 py-2.5 shadow-[var(--shadow-lg)] leading-relaxed w-52">
            {tooltip}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="px-4 py-3 bg-stone-50 rounded-xl">
      {inner}
    </div>
  )
}
