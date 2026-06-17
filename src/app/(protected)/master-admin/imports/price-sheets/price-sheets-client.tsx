'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { fuzzyBestMatch } from '@/lib/fuzzy'
import { isPerUnitService, makePerUnitTiers } from '@/lib/pricing'
import { parsePriceSheetFile, SUPPORTED_EXTS, type ParsedPriceRow, type ParseResult } from '@/lib/services-import-parse'

interface FacilityLite { id: string; name: string; facilityCode: string | null }

interface ExistingService {
  id: string
  name: string
  priceCents: number
  pricingType: string | null
  addonAmountCents: number | null
  pricingTiers: Array<{ minQty: number; maxQty: number; unitPriceCents: number }> | null
}

interface UpsertRow extends ParsedPriceRow {
  matchId: string | null
  oldCents: number | null
  newCents: number
  typeChanged: boolean
  status: 'create' | 'update' | 'unchanged'
  include: boolean
}

interface SheetFile {
  id: string
  fileName: string
  file: File
  facilityId: string | null
  facilitySource: 'filename' | 'content' | null  // how the facility was auto-detected
  status: 'pending' | 'parsing' | 'ready' | 'error'
  error?: string
  rows: UpsertRow[]
  expanded: boolean
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`

// The dollar amount that represents a row/service's price regardless of type.
function rowAmount(r: { pricingType?: string | null; priceCents: number; addonAmountCents?: number | null; pricingTiers?: Array<{ unitPriceCents: number }> | null; pricingOptions?: Array<{ priceCents: number }> | null }): number {
  switch (r.pricingType) {
    case 'addon': return r.addonAmountCents ?? 0
    case 'per_unit':
    case 'tiered': return r.pricingTiers?.[0]?.unitPriceCents ?? r.priceCents
    case 'multi_option': return r.pricingOptions?.[0]?.priceCents ?? r.priceCents
    default: return r.priceCents
  }
}
// The UI-level pricing type of an existing service (single-tier tiered → per_unit).
function existingType(s: ExistingService): string {
  if (isPerUnitService({ pricingType: s.pricingType ?? 'fixed', pricingTiers: s.pricingTiers })) return 'per_unit'
  return s.pricingType ?? 'fixed'
}

// Converts a row's UI pricing fields into the server payload ('per_unit' → a single
// open-ended tier so it reuses the tiered booking flow).
function pricingPayload(r: ParsedPriceRow) {
  if (r.pricingType === 'per_unit') {
    const unit = Math.round(r.priceCents)
    return { pricingType: 'tiered' as const, priceCents: unit, addonAmountCents: null, pricingTiers: makePerUnitTiers(unit), pricingOptions: null }
  }
  return {
    pricingType: (r.pricingType ?? 'fixed') as 'fixed' | 'addon' | 'tiered' | 'multi_option',
    priceCents: r.pricingType === 'addon' ? 0 : Math.round(r.priceCents),
    addonAmountCents: r.pricingType === 'addon' ? Math.round(r.addonAmountCents ?? 0) : null,
    pricingTiers: r.pricingType === 'tiered' ? r.pricingTiers ?? null : null,
    pricingOptions: r.pricingType === 'multi_option' ? r.pricingOptions ?? null : null,
  }
}

// Parse a facility code / name out of a filename: "F177 - Sunrise of Bethesda.pdf".
function detectFacility(fileName: string, facilities: FacilityLite[]): string | null {
  const base = fileName.replace(/\.[^.]+$/, '').trim()
  const m = base.match(/^(F\d{2,5})\s*[-–]\s*(.+)$/i)
  const code = m ? m[1].toUpperCase() : (base.match(/\bF\d{2,5}\b/i)?.[0]?.toUpperCase() ?? null)
  if (code) {
    const byCode = facilities.find((f) => f.facilityCode?.toUpperCase() === code)
    if (byCode) return byCode.id
  }
  const namePart = m ? m[2] : base
  const match = fuzzyBestMatch(facilities.map((f) => ({ name: f.name, id: f.id })), namePart, 0.7)
  return match?.id ?? null
}

export function PriceSheetsClient({ facilities }: { facilities: FacilityLite[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [sheets, setSheets] = useState<SheetFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<{ created: number; updated: number; facilities: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const servicesCache = useRef<Map<string, ExistingService[]>>(new Map())

  const loadServices = useCallback(async (facilityId: string): Promise<ExistingService[]> => {
    const cached = servicesCache.current.get(facilityId)
    if (cached) return cached
    const res = await fetch(`/api/super-admin/facility-services?facilityId=${facilityId}`)
    const json = await res.json()
    if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to load facility services')
    const list: ExistingService[] = json.data ?? []
    servicesCache.current.set(facilityId, list)
    return list
  }, [])

  const computeRows = useCallback((parsed: ParsedPriceRow[], existing: ExistingService[]): UpsertRow[] => {
    return parsed.map((p) => {
      const match = fuzzyBestMatch(existing, p.name, 0.7)
      const newCents = rowAmount(p)
      const pType = p.pricingType ?? 'fixed'
      if (!match) {
        return { ...p, matchId: null, oldCents: null, newCents, typeChanged: false, status: 'create', include: true }
      }
      const oldCents = rowAmount(match)
      const typeChanged = existingType(match) !== pType
      const changed = oldCents !== newCents || typeChanged
      return {
        ...p,
        matchId: match.id,
        oldCents,
        newCents,
        typeChanged,
        status: changed ? 'update' : 'unchanged',
        include: changed,
      }
    })
  }, [])

  const tryDetectFromContent = useCallback((detectedName: string | null): { facilityId: string | null; source: 'content' | null } => {
    if (!detectedName) return { facilityId: null, source: null }
    const match = fuzzyBestMatch(facilities.map((f) => ({ name: f.name, id: f.id })), detectedName, 0.65)
    return match ? { facilityId: match.id, source: 'content' } : { facilityId: null, source: null }
  }, [facilities])

  const processSheet = useCallback(async (sheet: SheetFile) => {
    setSheets((prev) => prev.map((s) => (s.id === sheet.id ? { ...s, status: 'parsing' } : s)))
    try {
      const { rows: parsed, detectedFacilityName }: ParseResult = await parsePriceSheetFile(sheet.file)
      // Content-based facility detection as fallback when filename didn't match
      let facilityId = sheet.facilityId
      let facilitySource = sheet.facilitySource
      if (!facilityId && detectedFacilityName) {
        const detected = tryDetectFromContent(detectedFacilityName)
        facilityId = detected.facilityId
        facilitySource = detected.source
      }
      const existing = facilityId ? await loadServices(facilityId) : []
      const rows = computeRows(parsed, existing)
      setSheets((prev) => prev.map((s) => (s.id === sheet.id ? { ...s, status: 'ready', rows, facilityId, facilitySource } : s)))
    } catch (err) {
      setSheets((prev) => prev.map((s) => (s.id === sheet.id ? { ...s, status: 'error', error: err instanceof Error ? err.message : 'Failed to read file' } : s)))
    }
  }, [loadServices, computeRows, tryDetectFromContent])

  const handleFiles = useCallback(async (files: File[]) => {
    setResult(null)
    setError(null)
    const accepted = files.filter((f) => SUPPORTED_EXTS.has(f.name.split('.').pop()?.toLowerCase() ?? ''))
    const newSheets: SheetFile[] = accepted.map((file) => {
      const facilityId = detectFacility(file.name, facilities)
      return {
        id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        fileName: file.name,
        file,
        facilityId,
        facilitySource: facilityId ? 'filename' as const : null,
        status: 'pending' as const,
        rows: [],
        expanded: false,
      }
    })
    setSheets((prev) => [...prev, ...newSheets])
    // Parse sequentially to keep the AI endpoint from being hammered.
    for (const s of newSheets) await processSheet(s)
  }, [facilities, processSheet])

  const changeFacility = useCallback(async (sheetId: string, rawFacilityId: string) => {
    const facilityId = rawFacilityId || null
    // User manually picked — clear the auto-detect source hint
    setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, facilityId, facilitySource: null, status: 'parsing' } : s)))
    try {
      const sheet = sheets.find((s) => s.id === sheetId)
      if (!sheet) return
      const existing = facilityId ? await loadServices(facilityId) : []
      // Re-derive rows from the already-parsed pricing data against the new facility.
      const parsed: ParsedPriceRow[] = sheet.rows.length
        ? sheet.rows.map((r) => ({ name: r.name, priceCents: r.priceCents, durationMinutes: r.durationMinutes, category: r.category, color: r.color, pricingType: r.pricingType, addonAmountCents: r.addonAmountCents, pricingTiers: r.pricingTiers, pricingOptions: r.pricingOptions }))
        : (await parsePriceSheetFile(sheet.file)).rows
      const rows = computeRows(parsed, existing)
      setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, facilityId, status: 'ready', rows } : s)))
    } catch (err) {
      setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, status: 'error', error: err instanceof Error ? err.message : 'Failed' } : s)))
    }
  }, [sheets, loadServices, computeRows])

  const toggleRow = (sheetId: string, idx: number) =>
    setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, rows: s.rows.map((r, i) => (i === idx ? { ...r, include: !r.include } : r)) } : s)))
  const toggleExpand = (sheetId: string) =>
    setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, expanded: !s.expanded } : s)))
  const removeSheet = (sheetId: string) => setSheets((prev) => prev.filter((s) => s.id !== sheetId))

  const totals = sheets.reduce(
    (acc, s) => {
      for (const r of s.rows) {
        if (!r.include || !s.facilityId) continue
        if (r.status === 'create') acc.create++
        else if (r.status === 'update') acc.update++
      }
      return acc
    },
    { create: 0, update: 0 }
  )
  const canApply = !applying && (totals.create > 0 || totals.update > 0) && sheets.every((s) => s.status !== 'parsing')

  const apply = async () => {
    setApplying(true)
    setError(null)
    // Group included rows by facility.
    const byFacility = new Map<string, { create: UpsertRow[]; update: UpsertRow[] }>()
    for (const s of sheets) {
      if (!s.facilityId) continue
      for (const r of s.rows) {
        if (!r.include) continue
        if (r.status === 'unchanged') continue
        const bucket = byFacility.get(s.facilityId) ?? { create: [], update: [] }
        if (r.status === 'create') bucket.create.push(r)
        else bucket.update.push(r)
        byFacility.set(s.facilityId, bucket)
      }
    }
    let created = 0
    let updated = 0
    let facilityCount = 0
    try {
      for (const [facilityId, { create, update }] of byFacility) {
        const res = await fetch('/api/super-admin/price-sheet-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            facilityId,
            create: create.map((r) => ({ name: r.name.trim(), durationMinutes: r.durationMinutes, color: r.color, category: r.category || null, ...pricingPayload(r) })),
            update: update.map((r) => ({ id: r.matchId!, durationMinutes: r.durationMinutes, ...pricingPayload(r) })),
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Apply failed')
        created += json.data.created
        updated += json.data.updated
        facilityCount++
        servicesCache.current.delete(facilityId) // bust so a re-run sees fresh prices
      }
      setResult({ created, updated, facilities: facilityCount })
      setSheets([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="page-enter p-6 md:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/master-admin/imports" className="p-2 hover:bg-stone-100 rounded-xl transition-colors text-stone-400 hover:text-stone-600">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-stone-900" style={{ fontFamily: "'DM Serif Display', serif" }}>Bulk Price Sheets</h1>
          <p className="text-sm text-stone-500 mt-0.5">Drop many sheets — each is routed to its facility, then prices update and new services are added.</p>
        </div>
      </div>

      {result && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800 mb-4">
          Done — <span className="font-semibold">{result.updated}</span> price{result.updated !== 1 ? 's' : ''} updated and <span className="font-semibold">{result.created}</span> service{result.created !== 1 ? 's' : ''} added across {result.facilities} facilit{result.facilities !== 1 ? 'ies' : 'y'}.
        </div>
      )}
      {error && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 mb-4">{error}</div>}

      {/* Drop zone */}
      <div
        onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(Array.from(e.dataTransfer.files)) }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onClick={() => fileInputRef.current?.click()}
        className={cn('flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 cursor-pointer transition-all', dragging ? 'border-[#8B2E4A] bg-rose-50' : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50')}
      >
        <p className="text-sm font-semibold text-stone-700">{dragging ? 'Drop to add' : 'Drop price sheets here'}</p>
        <p className="text-xs text-stone-400">or click to browse — add as many as you like</p>
        <p className="text-xs text-stone-400">.pdf, images, .docx, .csv, .xlsx · auto-routes by filename (F177 - Facility.pdf) or facility name at top of sheet</p>
        <input ref={fileInputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.docx,.csv,.xlsx,.xls,image/*" onChange={(e) => { handleFiles(Array.from(e.target.files ?? [])); e.target.value = '' }} className="sr-only" />
      </div>

      {/* Sheets */}
      <div className="mt-4 space-y-3">
        {sheets.map((sheet) => {
          const counts = sheet.rows.reduce((a, r) => { if (r.status === 'create') a.c++; else if (r.status === 'update') a.u++; else a.n++; return a }, { c: 0, u: 0, n: 0 })
          return (
            <div key={sheet.id} className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-800 truncate">{sheet.fileName}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <select
                      value={sheet.facilityId ?? ''}
                      onChange={(e) => changeFacility(sheet.id, e.target.value)}
                      className={cn('text-xs rounded-lg px-2 py-1 border focus:outline-none focus:border-[#8B2E4A] max-w-[260px]', sheet.facilityId ? 'border-stone-200 text-stone-700' : 'border-amber-300 text-amber-700 bg-amber-50')}
                    >
                      <option value="">— pick a facility —</option>
                      {facilities.map((f) => (
                        <option key={f.id} value={f.id}>{f.facilityCode ? `${f.facilityCode} · ` : ''}{f.name}</option>
                      ))}
                    </select>
                    {sheet.facilitySource === 'content' && (
                      <span className="text-[10px] text-stone-400 ml-1">matched from file</span>
                    )}
                    {sheet.facilitySource === 'filename' && (
                      <span className="text-[10px] text-stone-400 ml-1">matched from filename</span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {sheet.status === 'parsing' && <span className="text-xs text-stone-400">Reading…</span>}
                  {sheet.status === 'error' && <span className="text-xs text-red-600">{sheet.error}</span>}
                  {sheet.status === 'ready' && (
                    <button onClick={() => toggleExpand(sheet.id)} className="text-xs text-stone-600 hover:text-stone-900">
                      <span className="text-emerald-600 font-semibold">{counts.c} new</span> · <span className="text-amber-600 font-semibold">{counts.u} updated</span> · <span className="text-stone-400">{counts.n} same</span> {sheet.expanded ? '▲' : '▼'}
                    </button>
                  )}
                </div>
                <button onClick={() => removeSheet(sheet.id)} aria-label="Remove" className="p-1 text-stone-300 hover:text-red-500 shrink-0">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>

              {sheet.status === 'ready' && sheet.expanded && (
                <div className="border-t border-stone-100 divide-y divide-stone-50 max-h-[340px] overflow-y-auto">
                  {!sheet.facilityId && <p className="px-4 py-3 text-xs text-amber-700">Pick a facility to match these against existing services.</p>}
                  {sheet.rows.map((r, i) => (
                    <div key={i} className={cn('grid grid-cols-12 gap-2 items-center px-4 py-2 text-sm', r.status === 'unchanged' && 'opacity-50')}>
                      <div className="col-span-1">
                        <input type="checkbox" checked={r.include} disabled={r.status === 'unchanged' && !r.include} onChange={() => toggleRow(sheet.id, i)} className="rounded accent-[#8B2E4A] w-3.5 h-3.5" />
                      </div>
                      <div className="col-span-5 truncate">
                        <span className="text-stone-800">{r.name}</span>
                        {r.pricingType === 'per_unit' && <span className="ml-1.5 text-[10px] font-semibold text-emerald-700">each</span>}
                      </div>
                      <div className="col-span-3 text-xs text-stone-500">
                        {r.oldCents != null ? <>{dollars(r.oldCents)} → <span className="text-stone-800 font-medium">{dollars(r.newCents)}</span></> : <span className="text-stone-800 font-medium">{dollars(r.newCents)}</span>}
                      </div>
                      <div className="col-span-3 text-right">
                        {r.status === 'create' ? <span className="text-[11px] font-semibold text-emerald-600">New</span>
                          : r.status === 'unchanged' ? <span className="text-[11px] text-stone-400">No change</span>
                          : <span className="text-[11px] font-semibold text-amber-600">{r.typeChanged ? 'Type + price' : 'Price'}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {sheets.length > 0 && (
        <div className="flex items-center justify-between mt-5 sticky bottom-4">
          <p className="text-sm text-stone-500">
            <span className="font-semibold text-stone-900">{totals.update}</span> update{totals.update !== 1 ? 's' : ''} · <span className="font-semibold text-stone-900">{totals.create}</span> new
          </p>
          <button onClick={apply} disabled={!canApply} className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 active:scale-95" style={{ backgroundColor: '#8B2E4A' }}>
            {applying ? 'Applying…' : `Apply to ${new Set(sheets.filter((s) => s.facilityId && s.rows.some((r) => r.include && r.status !== 'unchanged')).map((s) => s.facilityId)).size} facilities`}
          </button>
        </div>
      )}
    </div>
  )
}
