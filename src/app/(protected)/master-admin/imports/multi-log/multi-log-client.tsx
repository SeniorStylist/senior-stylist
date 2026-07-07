'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import type { MultiFacilityGroup, ParsedMultiFacilityLog } from '@/lib/multi-facility-log'

const SpreadsheetIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2a4 4 0 014-4h6m-6 0V7a4 4 0 00-4-4H5a2 2 0 00-2 2v14a2 2 0 002 2h6m4-6h4m0 0l-2-2m2 2l-2 2" />
  </svg>
)
const CheckIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
)

interface FacilityImportResult {
  facilityCode: string
  facilityName: string
  facilityCreated: boolean
  reusedExisting: boolean
  skipped: boolean
  assignedCode: string | null
  stylistsCreated: number
  residentsUpserted: number
  bookingsCreated: number
  duplicatesSkipped: number
  servicesMatched: number
  unresolvedCount: number
  rowsSkipped: number
}

interface Failure {
  facilityCode: string
  facilityName: string
  error: string
}

interface ExistingInfo {
  id: string
  name: string
  facilityCode: string | null
  bookings: number
}
type ResolutionStatus = 'new' | 'exact' | 'code_name_diff' | 'possible_duplicate'
interface FacilityResolution {
  facilityCode: string
  facilityName: string
  status: ResolutionStatus
  existing: ExistingInfo | null
  score: number | null
}
// Operator's per-facility choice. 'create' = default (new, or reuse-by-code keeping name).
// 'new_code' = same F-code but a different community → mint a fresh code.
type Choice = 'create' | 'rename' | 'merge' | 'skip' | 'new_code'

interface ResolutionBody {
  mode: 'create' | 'reuse' | 'skip' | 'new_code'
  facilityId?: string
  renameTo?: string
  adoptCode?: boolean
}

type State = 'upload' | 'preview' | 'importing' | 'done'

const EMPTY_TOTALS = {
  facilitiesCreated: 0,
  stylistsCreated: 0,
  residentsUpserted: 0,
  bookingsCreated: 0,
  servicesMatched: 0,
  unresolvedCount: 0,
  duplicatesSkipped: 0,
}

export function MultiLogClient() {
  const [state, setState] = useState<State>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedMultiFacilityLog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)

  // facility-conflict resolution
  const [resolutions, setResolutions] = useState<Record<string, FacilityResolution>>({})
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [nextCode, setNextCode] = useState<string | null>(null)

  // import progress
  const [doneCount, setDoneCount] = useState(0)
  const [currentName, setCurrentName] = useState('')
  const [results, setResults] = useState<FacilityImportResult[]>([])
  const [failures, setFailures] = useState<Failure[]>([])
  const [skippedCount, setSkippedCount] = useState(0)

  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelect(f: File) {
    setError(null)
    setFile(f)
    setParsing(true)
    try {
      const { parseMultiFacilityServiceLog } = await import('@/lib/multi-facility-log')
      const buffer = await f.arrayBuffer()
      const data = parseMultiFacilityServiceLog(buffer)
      if (data.groups.length === 0) {
        throw new Error('No importable rows found. Every facility cell must start with an F-code (e.g. "F123 - Name").')
      }
      setParsed(data)

      // Detect facility conflicts (same code/different name, possible duplicates).
      // Non-fatal — if it fails, every facility defaults to create-or-reuse-by-code.
      try {
        const res = await fetch('/api/super-admin/import-multi-log/resolve-facilities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groups: data.groups.map((g) => ({ facilityCode: g.facilityCode, facilityName: g.facilityName })),
          }),
        })
        const json = await res.json()
        if (res.ok && Array.isArray(json.data?.resolutions)) {
          const map: Record<string, FacilityResolution> = {}
          const defaults: Record<string, Choice> = {}
          for (const r of json.data.resolutions as FacilityResolution[]) {
            map[r.facilityCode] = r
            defaults[r.facilityCode] = 'create'
          }
          setResolutions(map)
          setChoices(defaults)
          if (typeof json.data.nextAvailableCode === 'string') setNextCode(json.data.nextAvailableCode)
        }
      } catch {
        /* non-fatal */
      }

      setState('preview')
    } catch (err) {
      setError(`Could not parse file: ${(err as Error).message}`)
    } finally {
      setParsing(false)
    }
  }

  function choiceToResolution(group: MultiFacilityGroup): ResolutionBody | undefined {
    const r = resolutions[group.facilityCode]
    const choice = choices[group.facilityCode] ?? 'create'
    if (choice === 'skip') return { mode: 'skip' }
    if (choice === 'new_code') return { mode: 'new_code' }
    if (!r || !r.existing) return undefined
    if (choice === 'rename') return { mode: 'reuse', facilityId: r.existing.id, renameTo: group.facilityName }
    if (choice === 'merge') return { mode: 'reuse', facilityId: r.existing.id, adoptCode: r.existing.facilityCode == null }
    return undefined
  }

  async function importGroup(group: MultiFacilityGroup): Promise<FacilityImportResult> {
    const resolution = choiceToResolution(group)
    const res = await fetch('/api/super-admin/import-multi-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        facilityCode: group.facilityCode,
        facilityName: group.facilityName,
        paymentTypeHint: group.paymentTypeHint,
        fileName: file?.name,
        rows: group.rows,
        ...(resolution ? { resolution } : {}),
      }),
    })
    const text = await res.text().catch(() => '')
    let json: { data?: FacilityImportResult; error?: unknown } = {}
    try { json = JSON.parse(text) } catch { throw new Error(text.slice(0, 200) || `Server error (${res.status})`) }
    if (!res.ok || !json.data) {
      const msg = typeof json.error === 'string' ? json.error : `Import failed (${res.status})`
      throw new Error(msg)
    }
    return json.data
  }

  async function runImport() {
    if (!parsed) return
    setState('importing')
    setError(null)
    setDoneCount(0)
    setResults([])
    setFailures([])
    setSkippedCount(0)

    const collected: FacilityImportResult[] = []
    const failed: Failure[] = []
    let skipped = 0
    for (const group of parsed.groups) {
      // Skip without a round-trip when the operator chose to skip this facility.
      if ((choices[group.facilityCode] ?? 'create') === 'skip') {
        skipped += 1
        setSkippedCount(skipped)
        setDoneCount((n) => n + 1)
        continue
      }
      setCurrentName(group.facilityName)
      try {
        const r = await importGroup(group)
        collected.push(r)
        setResults((prev) => [...prev, r])
      } catch (err) {
        failed.push({
          facilityCode: group.facilityCode,
          facilityName: group.facilityName,
          error: (err as Error).message,
        })
        setFailures((prev) => [...prev, { facilityCode: group.facilityCode, facilityName: group.facilityName, error: (err as Error).message }])
      }
      setDoneCount((n) => n + 1)
    }
    setResults(collected)
    setFailures(failed)
    setState('done')
  }

  function reset() {
    setFile(null)
    setParsed(null)
    setError(null)
    setResolutions({})
    setChoices({})
    setNextCode(null)
    setResults([])
    setFailures([])
    setSkippedCount(0)
    setDoneCount(0)
    setCurrentName('')
    setState('upload')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const totals = results.reduce((acc, r) => ({
    facilitiesCreated: acc.facilitiesCreated + (r.facilityCreated ? 1 : 0),
    stylistsCreated: acc.stylistsCreated + r.stylistsCreated,
    residentsUpserted: acc.residentsUpserted + r.residentsUpserted,
    bookingsCreated: acc.bookingsCreated + r.bookingsCreated,
    servicesMatched: acc.servicesMatched + r.servicesMatched,
    unresolvedCount: acc.unresolvedCount + r.unresolvedCount,
    duplicatesSkipped: acc.duplicatesSkipped + r.duplicatesSkipped,
  }), { ...EMPTY_TOTALS })

  const progressPct = parsed && parsed.groups.length > 0
    ? Math.round((doneCount / parsed.groups.length) * 100)
    : 0

  const setChoice = (code: string, c: Choice) => setChoices((prev) => ({ ...prev, [code]: c }))

  const conflictCount = parsed
    ? parsed.groups.filter((g) => {
        const r = resolutions[g.facilityCode]
        return r && (r.status === 'code_name_diff' || r.status === 'possible_duplicate')
      }).length
    : 0
  const plannedSkips = parsed
    ? parsed.groups.filter((g) => (choices[g.facilityCode] ?? 'create') === 'skip').length
    : 0
  const plannedImports = parsed ? parsed.groups.length - plannedSkips : 0

  return (
    <div className="page-enter min-h-screen bg-stone-50 p-6">
      <div className="max-w-3xl mx-auto">
        <Link
          href="/master-admin/imports"
          className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700 mb-6"
        >
          <span>←</span> Back to Imports
        </Link>

        {/* Step 1 — upload */}
        {state === 'upload' && (
          <div className="bg-white rounded-2xl border border-stone-200 p-8">
            <h1 className="text-2xl font-normal mb-2" style={{ fontFamily: "'DM Serif Display', serif", color: '#8B2E4A' }}>
              Multi-Facility Log Import
            </h1>
            <p className="text-sm text-stone-500 mb-8">
              Upload one bookkeeper XLSX containing <span className="font-medium text-stone-700">every facility&apos;s</span> daily log.
              We&apos;ll group rows by facility code, auto-create any missing facilities and stylists, create new residents,
              and link services by name. Services are never created — unmatched lines import as historical records flagged for review.
            </p>

            {error && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f) }}
            />
            <div
              onClick={() => !parsing && fileInputRef.current?.click()}
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
              <p className="text-sm font-medium text-stone-600">{parsing ? 'Parsing…' : 'Click to select XLSX file'}</p>
              <p className="text-xs text-stone-400 mt-1">or drag and drop</p>
            </div>
          </div>
        )}

        {/* Step 2 — preview */}
        {state === 'preview' && parsed && (
          <div className="bg-white rounded-2xl border border-stone-200 p-8">
            <h1 className="text-2xl font-normal mb-2" style={{ fontFamily: "'DM Serif Display', serif", color: '#8B2E4A' }}>
              Confirm Import
            </h1>
            <p className="text-sm text-stone-500 mb-6">{file?.name}</p>

            {error && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
            )}

            <div className="grid grid-cols-3 gap-3 mb-6">
              <PreviewStat label="Facilities" value={parsed.totalFacilities} />
              <PreviewStat label="Stylists" value={parsed.totalStylists} />
              <PreviewStat label="Bookings" value={parsed.totalRows} />
            </div>

            {(parsed.skippedRows > 0 || parsed.uncodedFacilities.length > 0) && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
                {parsed.skippedRows > 0 && (
                  <p><span className="font-semibold">{parsed.skippedRows.toLocaleString()}</span> rows skipped (no amount, no date, or blank client).</p>
                )}
                {parsed.uncodedFacilities.length > 0 && (
                  <p>
                    <span className="font-semibold">{parsed.uncodedFacilities.length}</span> facility cell(s) had no F-code and were ignored:{' '}
                    <span className="font-mono">{parsed.uncodedFacilities.slice(0, 3).join(', ')}{parsed.uncodedFacilities.length > 3 ? '…' : ''}</span>
                  </p>
                )}
              </div>
            )}

            {conflictCount > 0 && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <span className="font-semibold">{conflictCount}</span> facilit{conflictCount === 1 ? 'y' : 'ies'} need a decision — either the F-code matches a facility with a different name, or the name looks like a duplicate of one you already have. Pick how to handle each in the table below.
              </div>
            )}

            <div className="rounded-xl border border-stone-100 mb-6 max-h-80 overflow-y-auto overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-stone-50/60 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Facility</th>
                    <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Resolution</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Stylists</th>
                    <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-stone-400 uppercase tracking-wide">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.groups.map((g) => {
                    const r = resolutions[g.facilityCode]
                    const choice = choices[g.facilityCode] ?? 'create'
                    const isSkipped = choice === 'skip'
                    return (
                      <tr key={g.facilityCode} className={`border-t border-stone-100 ${isSkipped ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-2.5 text-stone-800 align-top">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-stone-400">{g.facilityCode}</span>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-stone-100 text-stone-500 uppercase">{g.paymentTypeHint}</span>
                          </div>
                          <div className="text-stone-800 mt-0.5">{g.facilityName}</div>
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <ResolutionCell
                            group={g}
                            resolution={r}
                            choice={choice}
                            nextCode={nextCode}
                            onChange={(c) => setChoice(g.facilityCode, c)}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right text-stone-600 align-top">{g.stylistCount}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-stone-800 align-top">{g.rows.length.toLocaleString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={reset} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={runImport}
                disabled={plannedImports === 0}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40"
                style={{ backgroundColor: '#8B2E4A' }}
                onMouseEnter={(e) => { if (plannedImports > 0) e.currentTarget.style.backgroundColor = '#72253C' }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#8B2E4A' }}
              >
                Import {plannedImports} facilit{plannedImports === 1 ? 'y' : 'ies'} →
                {plannedSkips > 0 && <span className="opacity-75"> ({plannedSkips} skipped)</span>}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — importing */}
        {state === 'importing' && parsed && (
          <div className="bg-white rounded-2xl border border-stone-200 p-8">
            <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-4">
              <SpreadsheetIcon className="w-6 h-6 text-[#8B2E4A]" />
            </div>
            <h3 className="text-base font-semibold text-stone-900 text-center mb-1">
              Importing… {doneCount} of {parsed.groups.length}
            </h3>
            <p className="text-sm text-stone-500 text-center mb-5 truncate">{currentName}</p>
            <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-[#8B2E4A] rounded-full transition-[width] duration-300 ease-out" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="text-xs text-stone-400 text-center">Keep this tab open until all facilities finish.</p>
            {failures.length > 0 && (
              <p className="text-xs text-amber-700 text-center mt-3">{failures.length} facility(ies) failed so far — you can retry them after.</p>
            )}
          </div>
        )}

        {/* Step 4 — done */}
        {state === 'done' && (
          <div className="bg-white rounded-2xl border border-stone-200 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckIcon className="w-5 h-5 text-emerald-600" />
              </div>
              <h2 className="text-lg font-semibold text-stone-900">
                Import complete — {results.length} facilities
              </h2>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
              <ResultTile label="Bookings created" value={totals.bookingsCreated} accent="emerald" />
              <ResultTile label="Facilities created" value={totals.facilitiesCreated} accent="stone" />
              <ResultTile label="Stylists created" value={totals.stylistsCreated} accent="stone" />
              <ResultTile label="Residents created" value={totals.residentsUpserted} accent="stone" />
              <ResultTile label="Services matched" value={totals.servicesMatched} accent="stone" />
              <ResultTile label="Need review" value={totals.unresolvedCount} accent={totals.unresolvedCount > 0 ? 'amber' : 'stone'} />
              <ResultTile label="Duplicates skipped" value={totals.duplicatesSkipped} accent="stone" />
              {skippedCount > 0 && <ResultTile label="Facilities skipped" value={skippedCount} accent="stone" />}
            </div>

            {results.some((r) => r.assignedCode) && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <p className="text-sm font-semibold text-emerald-800 mb-2">New codes assigned to separate communities</p>
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {results.filter((r) => r.assignedCode).map((r) => (
                    <li key={r.facilityCode} className="text-xs text-emerald-700">
                      <span className="font-mono">{r.facilityCode}</span> on the sheet → created as{' '}
                      <span className="font-mono font-semibold">{r.assignedCode}</span> · {r.facilityName}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {failures.length > 0 && (
              <div className="mb-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200">
                <p className="text-sm font-semibold text-red-700 mb-2">{failures.length} facility(ies) failed</p>
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {failures.map((f) => (
                    <li key={f.facilityCode} className="text-xs text-red-600">
                      <span className="font-mono">{f.facilityCode}</span> {f.facilityName} — {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button onClick={reset} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-stone-200 text-stone-600 hover:bg-stone-50 transition-colors">
                Import another file
              </button>
              {totals.unresolvedCount > 0 ? (
                <Link href="/master-admin/imports?tab=review" className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white text-center transition-colors" style={{ backgroundColor: '#8B2E4A' }}>
                  Review {totals.unresolvedCount} unmatched →
                </Link>
              ) : (
                <Link href="/master-admin/imports" className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white text-center transition-colors" style={{ backgroundColor: '#8B2E4A' }}>
                  Back to Imports →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ResolutionCell({
  group,
  resolution,
  choice,
  nextCode,
  onChange,
}: {
  group: MultiFacilityGroup
  resolution: FacilityResolution | undefined
  choice: Choice
  nextCode: string | null
  onChange: (c: Choice) => void
}) {
  // No resolution data (detection failed) or brand-new facility → simple badge.
  if (!resolution || resolution.status === 'new') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 uppercase">New</span>
        <SkipToggle choice={choice} onChange={onChange} />
      </div>
    )
  }

  if (resolution.status === 'exact') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 uppercase">Existing</span>
        <span className="text-xs text-stone-400">adds to current records</span>
        <SkipToggle choice={choice} onChange={onChange} />
      </div>
    )
  }

  const existing = resolution.existing!

  if (resolution.status === 'code_name_diff') {
    return (
      <div className="space-y-1">
        <p className="text-[11px] text-amber-700">
          {group.facilityCode} already exists as <span className="font-semibold">{existing.name}</span>
          {existing.bookings > 0 && <span className="text-amber-600"> · {existing.bookings.toLocaleString()} bookings</span>}
        </p>
        <select
          value={choice}
          onChange={(e) => onChange(e.target.value as Choice)}
          className="text-xs px-2 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20"
        >
          <option value="create">Same place — keep name “{existing.name}”</option>
          <option value="rename">Same place — rename to “{group.facilityName}”</option>
          <option value="new_code">Different community — new code{nextCode ? ` (${nextCode}+)` : ''}</option>
          <option value="skip">Skip this facility</option>
        </select>
      </div>
    )
  }

  // possible_duplicate
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-amber-700">
        Looks like <span className="font-semibold">{existing.name}</span>
        {existing.facilityCode && <span className="font-mono text-amber-600"> ({existing.facilityCode})</span>}
        {existing.bookings > 0 && <span className="text-amber-600"> · {existing.bookings.toLocaleString()} bookings</span>}
        {resolution.score != null && <span className="text-amber-500"> · {Math.round(resolution.score * 100)}% match</span>}
      </p>
      <select
        value={choice}
        onChange={(e) => onChange(e.target.value as Choice)}
        className="text-xs px-2 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20"
      >
        <option value="create">Create new {group.facilityCode}</option>
        <option value="merge">Merge into “{existing.name}”</option>
        <option value="skip">Skip this facility</option>
      </select>
    </div>
  )
}

function SkipToggle({ choice, onChange }: { choice: Choice; onChange: (c: Choice) => void }) {
  if (choice === 'skip') {
    return (
      <button type="button" onClick={() => onChange('create')} className="text-[11px] text-stone-500 hover:text-stone-700 underline">
        skipped — undo
      </button>
    )
  }
  return (
    <button type="button" onClick={() => onChange('skip')} className="text-[11px] text-stone-300 hover:text-stone-500">
      skip
    </button>
  )
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-4 py-3 bg-stone-50 rounded-xl text-center">
      <p className="text-xl font-semibold text-stone-900">{value.toLocaleString()}</p>
      <p className="text-xs text-stone-500 mt-0.5">{label}</p>
    </div>
  )
}

function ResultTile({ label, value, accent }: { label: string; value: number; accent: 'emerald' | 'amber' | 'stone' }) {
  const valueColor = accent === 'emerald' ? 'text-emerald-700' : accent === 'amber' ? 'text-amber-700' : 'text-stone-900'
  return (
    <div className="px-4 py-3 bg-stone-50 rounded-xl">
      <p className="text-xs text-stone-500 mb-1">{label}</p>
      <p className={`text-xl font-semibold ${valueColor}`}>{value.toLocaleString()}</p>
    </div>
  )
}
