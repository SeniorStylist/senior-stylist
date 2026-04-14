'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Stylist } from '@/types'

interface FacilityOption {
  id: string
  name: string
}

interface DirectoryClientProps {
  initialStylists: Stylist[]
  franchiseFacilities: FacilityOption[]
  franchiseName: string
}

type Filter = 'all' | 'assigned' | 'unassigned'

interface ImportResult {
  imported: number
  updated: number
  errors: Array<{ row: number; message: string }>
}

export function DirectoryClient({
  initialStylists,
  franchiseFacilities,
  franchiseName,
}: DirectoryClientProps) {
  const router = useRouter()
  const [stylists, setStylists] = useState<Stylist[]>(initialStylists)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addCode, setAddCode] = useState('')
  const [addColor, setAddColor] = useState('#8B2E4A')
  const [addCommission, setAddCommission] = useState('40')
  const [addFacilityId, setAddFacilityId] = useState<string>('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addSubmitting, setAddSubmitting] = useState(false)

  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSubmitting, setImportSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const facilityById = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of franchiseFacilities) m.set(f.id, f.name)
    return m
  }, [franchiseFacilities])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stylists.filter((s) => {
      if (filter === 'assigned' && !s.facilityId) return false
      if (filter === 'unassigned' && s.facilityId) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        s.stylistCode.toLowerCase().includes(q)
      )
    })
  }, [stylists, filter, search])

  const handleAdd = async () => {
    if (!addName.trim()) return
    setAddSubmitting(true)
    setAddError(null)
    try {
      const body: Record<string, unknown> = {
        name: addName.trim(),
        color: addColor,
        commissionPercent: Math.max(0, Math.min(100, parseInt(addCommission, 10) || 0)),
        facilityId: addFacilityId || null,
      }
      if (addCode.trim()) body.stylistCode = addCode.trim()
      const res = await fetch('/api/stylists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAddError(typeof json.error === 'string' ? json.error : 'Failed to add stylist')
        return
      }
      setStylists((prev) => [json.data as Stylist, ...prev].sort((a, b) => a.name.localeCompare(b.name)))
      setAddOpen(false)
      setAddName('')
      setAddCode('')
      setAddColor('#8B2E4A')
      setAddCommission('40')
      setAddFacilityId('')
      router.refresh()
    } catch {
      setAddError('Failed to add stylist')
    } finally {
      setAddSubmitting(false)
    }
  }

  const handleImport = async () => {
    if (!importFile) return
    setImportSubmitting(true)
    setImportError(null)
    setImportResult(null)
    try {
      const fd = new FormData()
      fd.append('file', importFile)
      const res = await fetch('/api/stylists/import', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setImportError(typeof json.error === 'string' ? json.error : 'Import failed')
        return
      }
      setImportResult(json.data as ImportResult)
      router.refresh()
    } catch {
      setImportError('Import failed')
    } finally {
      setImportSubmitting(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-2xl font-bold text-stone-900"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Directory
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {franchiseName} · {stylists.length} stylist{stylists.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="px-3 py-2 rounded-xl text-sm font-medium border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors"
          >
            Import
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="px-3 py-2 rounded-xl text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: '#8B2E4A' }}
          >
            + Add Stylist
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or ST code"
          className="flex-1 min-w-[240px] px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-100"
        />
        <div className="flex rounded-xl border border-stone-200 overflow-hidden bg-white">
          {(['all', 'assigned', 'unassigned'] as Filter[]).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${
                filter === k ? 'text-white' : 'text-stone-600 hover:bg-stone-50'
              }`}
              style={filter === k ? { backgroundColor: '#8B2E4A' } : undefined}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {addOpen && (
        <div className="mb-4 p-4 rounded-2xl bg-rose-50 border border-rose-100">
          <p className="text-sm font-semibold text-stone-900 mb-3">Add Stylist</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-600 block mb-1">Name *</label>
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                maxLength={200}
                className="w-full px-3 py-2 rounded-xl border border-rose-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-100"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-stone-600 block mb-1">
                ST code <span className="text-stone-400">(auto if blank)</span>
              </label>
              <input
                value={addCode}
                onChange={(e) => setAddCode(e.target.value.toUpperCase())}
                placeholder="ST###"
                pattern="^ST\d{3,}$"
                className="w-full px-3 py-2 rounded-xl border border-rose-200 text-sm bg-white font-mono focus:outline-none focus:ring-2 focus:ring-rose-100"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-stone-600 block mb-1">Color</label>
              <input
                type="color"
                value={addColor}
                onChange={(e) => setAddColor(e.target.value)}
                className="w-full h-10 rounded-xl border border-rose-200 bg-white cursor-pointer"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-stone-600 block mb-1">Commission %</label>
              <input
                type="number"
                min={0}
                max={100}
                value={addCommission}
                onChange={(e) => setAddCommission(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-rose-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-100"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-stone-600 block mb-1">Facility</label>
              <select
                value={addFacilityId}
                onChange={(e) => setAddFacilityId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-rose-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-rose-100"
              >
                <option value="">Unassigned (franchise pool)</option>
                {franchiseFacilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {addError && <p className="text-xs text-red-600 mt-2">{addError}</p>}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleAdd}
              disabled={!addName.trim() || addSubmitting}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              {addSubmitting ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => {
                setAddOpen(false)
                setAddError(null)
              }}
              className="px-4 py-2 rounded-xl text-sm text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="mb-4 p-4 rounded-2xl bg-rose-50 border border-rose-100">
          <p className="text-sm font-semibold text-stone-900 mb-1">Import Stylists</p>
          <p className="text-xs text-stone-600 mb-3">
            CSV or XLSX. Columns: name, code (optional), color, commission, facility, licenseNumber, licenseType, licenseExpires. Max 200 rows.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            className="block text-sm text-stone-700 mb-3"
          />
          {importError && <p className="text-xs text-red-600 mb-2">{importError}</p>}
          {importResult && (
            <div className="mb-3 p-3 rounded-xl bg-white border border-stone-200">
              <p className="text-sm text-stone-800">
                <span className="font-semibold text-emerald-700">{importResult.imported}</span> imported,{' '}
                <span className="font-semibold">{importResult.updated}</span> updated,{' '}
                <span className={`font-semibold ${importResult.errors.length ? 'text-red-600' : 'text-stone-500'}`}>
                  {importResult.errors.length}
                </span>{' '}
                errors
              </p>
              {importResult.errors.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-stone-600 cursor-pointer">View errors</summary>
                  <ul className="mt-2 text-xs text-red-600 space-y-1">
                    {importResult.errors.map((e, i) => (
                      <li key={i}>
                        Row {e.row}: {e.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={!importFile || importSubmitting}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              {importSubmitting ? 'Importing…' : 'Import'}
            </button>
            <button
              onClick={() => {
                setImportOpen(false)
                setImportFile(null)
                setImportResult(null)
                setImportError(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              className="px-4 py-2 rounded-xl text-sm text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-12 text-center">
          <p className="text-stone-400 text-sm">No stylists match this filter.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {filtered.map((s) => {
            const facility = s.facilityId ? facilityById.get(s.facilityId) : null
            return (
              <Link
                key={s.id}
                href={`/stylists/${s.id}`}
                className="flex items-center gap-3 px-5 py-3.5 hover:bg-stone-50 transition-colors border-b border-stone-50 last:border-0"
              >
                <span className="font-mono text-xs text-stone-500 w-16 shrink-0">
                  {s.stylistCode}
                </span>
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: s.color }}
                  title="Calendar color"
                />
                <span className="text-sm font-semibold text-stone-900 flex-1 min-w-0 truncate">
                  {s.name}
                </span>
                {facility ? (
                  <span className="text-xs px-2 py-0.5 rounded-md bg-stone-100 text-stone-600 shrink-0">
                    {facility}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-md bg-rose-50 text-[#8B2E4A] shrink-0">
                    Franchise Pool
                  </span>
                )}
                <span className="text-xs text-stone-500 shrink-0 hidden sm:inline">
                  {s.commissionPercent}%
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="text-stone-300 shrink-0"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
