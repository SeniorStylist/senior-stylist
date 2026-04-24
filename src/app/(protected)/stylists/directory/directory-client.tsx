'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Applicant, ApplicantStatus, Stylist, StylistStatus } from '@/types'
import { useToast } from '@/components/ui/toast'
import { Avatar } from '@/components/ui/avatar'
import { getZipsWithinMiles, extractZip } from '@/lib/zip-coords'

interface FacilityOption {
  id: string
  name: string
}

interface DirectoryClientProps {
  initialStylists: Stylist[]
  franchiseFacilities: FacilityOption[]
  franchiseName: string
  initialApplicants: Applicant[]
}


const APP_STATUS_LABELS: ApplicantStatus[] = ['new', 'reviewing', 'contacting', 'hired', 'rejected']

function formatAppliedDate(d: string): string {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const METRO_ALIASES: Record<string, string[]> = {
  washington: ['arlington', 'bethesda', 'alexandria', 'mclean', 'tysons', 'reston', 'herndon', 'fairfax', 'silver spring', 'rockville', 'gaithersburg', 'germantown', 'potomac', 'chevy chase', 'college park', 'laurel', 'bowie', 'annapolis', 'waldorf', 'fredericksburg'],
  baltimore: ['towson', 'columbia', 'ellicott city', 'catonsville', 'dundalk', 'essex', 'parkville', 'perry hall', 'bel air', 'glen burnie', 'pasadena', 'severn', 'millersville', 'hanover', 'odenton', 'annapolis'],
  annapolis: ['severn', 'arnold', 'millersville', 'odenton', 'crofton', 'gambrills', 'glen burnie', 'pasadena'],
  richmond: ['henrico', 'chesterfield', 'midlothian', 'mechanicsville', 'glen allen', 'short pump'],
  norfolk: ['virginia beach', 'chesapeake', 'portsmouth', 'suffolk', 'hampton', 'newport news'],
  philadelphia: ['camden', 'cherry hill', 'king of prussia', 'wilmington', 'chester', 'norristown'],
  minneapolis: ['st paul', 'bloomington', 'eden prairie', 'plymouth', 'minnetonka', 'edina', 'burnsville', 'st louis park', 'golden valley'],
}

function fuzzyField(text: string, query: string): boolean {
  if (text.includes(query)) return true
  let ti = 0
  let matched = 0
  for (let qi = 0; qi < query.length; qi++) {
    while (ti < text.length && text[ti] !== query[qi]) ti++
    if (ti < text.length) { matched++; ti++ }
  }
  return matched / query.length >= 0.8
}

function metroTerms(query: string): string[] {
  const terms = new Set<string>([query])
  if (METRO_ALIASES[query]) METRO_ALIASES[query].forEach((t) => terms.add(t))
  for (const [metro, aliases] of Object.entries(METRO_ALIASES)) {
    if (aliases.some((a) => a === query || query.includes(a) || a.includes(query))) {
      terms.add(metro)
      aliases.forEach((t) => terms.add(t))
    }
  }
  return Array.from(terms)
}

function appMatchesSearch(a: Applicant, q: string, nearbyZips: string[] | null): boolean {
  if (nearbyZips) {
    const applicantZip = extractZip(a.location ?? '')
    if (applicantZip && nearbyZips.includes(applicantZip)) return true
  }
  const name = a.name.toLowerCase()
  const email = (a.email ?? '').toLowerCase()
  if (fuzzyField(name, q) || fuzzyField(email, q)) return true
  const loc = (a.location ?? '').toLowerCase()
  return metroTerms(q).some((t) => loc.includes(t))
}

type Filter = 'all' | 'assigned' | 'unassigned'
type StatusFilter = 'all' | 'active' | 'on_leave' | 'inactive' | 'terminated'

const STATUS_BADGE: Record<
  Exclude<StatusFilter, 'all' | 'active'>,
  { label: string; className: string }
> = {
  on_leave: { label: 'On Leave', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  inactive: { label: 'Inactive', className: 'bg-stone-100 text-stone-500 border border-stone-200' },
  terminated: { label: 'Terminated', className: 'bg-red-50 text-red-600 border border-red-200' },
}

interface ImportResult {
  imported: number
  updated: number
  availabilityCreated: number
  scheduleNotes: number
  errors: Array<{ row: number; message: string }>
}

export function DirectoryClient({
  initialStylists,
  franchiseFacilities,
  franchiseName,
  initialApplicants,
}: DirectoryClientProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [stylists, setStylists] = useState<Stylist[]>(initialStylists)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deletingBulk, setDeletingBulk] = useState(false)
  const [bulkStatusValue, setBulkStatusValue] = useState<StylistStatus | ''>('')
  const [bulkFacilityId, setBulkFacilityId] = useState('')
  const [bulkCommission, setBulkCommission] = useState('')
  const [applyingBulk, setApplyingBulk] = useState(false)
  const [dupMode, setDupMode] = useState(false)
  const [sortKey, setSortKey] = useState<'code' | 'name' | 'facility' | 'commission' | 'status'>('name')

  // Applicant pipeline state
  const [activeTab, setActiveTab] = useState<'stylists' | 'applicants'>('stylists')
  const [appApplicants, setAppApplicants] = useState<Applicant[]>(initialApplicants)
  const [appSearch, setAppSearch] = useState('')
  const [appRadiusMiles, setAppRadiusMiles] = useState(15)
  const [appStatusFilter, setAppStatusFilter] = useState<ApplicantStatus | 'all'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedNotes, setExpandedNotes] = useState('')
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [promotedResult, setPromotedResult] = useState<Record<string, string>>({})
  const [importingCSV, setImportingCSV] = useState(false)
  const [importBanner, setImportBanner] = useState<{ imported: number; skipped: number } | null>(null)
  const appFileInputRef = useRef<HTMLInputElement | null>(null)
  const [appSortKey, setAppSortKey] = useState<'name' | 'location' | 'job' | 'date' | 'status'>('date')
  const [appSortDir, setAppSortDir] = useState<'asc' | 'desc'>('desc')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

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
  const selectAllRef = useRef<HTMLInputElement | null>(null)

  const facilityById = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of franchiseFacilities) m.set(f.id, f.name)
    return m
  }, [franchiseFacilities])

  const dupInfo = useMemo(() => {
    const nameCounts = new Map<string, string[]>()
    const codeCounts = new Map<string, string[]>()

    for (const s of stylists) {
      const normName = s.name.trim().toLowerCase()
      nameCounts.set(normName, [...(nameCounts.get(normName) ?? []), s.id])
      const code = (s.stylistCode ?? '').trim().toLowerCase()
      codeCounts.set(code, [...(codeCounts.get(code) ?? []), s.id])
    }

    const dupNameIds = new Set<string>()
    const nameSelectIds = new Set<string>()
    let dupNameCount = 0
    for (const ids of nameCounts.values()) {
      if (ids.length > 1) {
        dupNameCount++
        ids.forEach((id) => dupNameIds.add(id))
        ids.slice(1).forEach((id) => nameSelectIds.add(id))
      }
    }

    const dupCodeIds = new Set<string>()
    const codeSelectIds = new Set<string>()
    let dupCodeCount = 0
    for (const ids of codeCounts.values()) {
      if (ids.length > 1) {
        dupCodeCount++
        ids.forEach((id) => dupCodeIds.add(id))
        ids.slice(1).forEach((id) => codeSelectIds.add(id))
      }
    }

    const dupSelectIds = new Set([...nameSelectIds, ...codeSelectIds])
    return { dupNameIds, dupCodeIds, dupSelectIds, dupNameCount, dupCodeCount }
  }, [stylists])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return stylists.filter((s) => {
      if (filter === 'assigned' && !s.facilityId) return false
      if (filter === 'unassigned' && s.facilityId) return false
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (!q) return true
      return (
        s.name.toLowerCase().includes(q) ||
        s.stylistCode.toLowerCase().includes(q)
      )
    })
  }, [stylists, filter, statusFilter, search])

  // ─── Applicant pipeline handlers ─────────────────────────────────────────

  const filteredApplicants = useMemo(() => {
    const q = appSearch.trim().toLowerCase()
    const isZip = /^\d{5}$/.test(q)
    const nearbyZips = isZip ? getZipsWithinMiles(q, appRadiusMiles) : null
    const filtered = appApplicants.filter((a) => {
      if (appStatusFilter !== 'all' && a.status !== appStatusFilter) return false
      if (!q) return true
      return appMatchesSearch(a, q, nearbyZips)
    })
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (appSortKey === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (appSortKey === 'location') {
        const aLoc = a.location ?? ''
        const bLoc = b.location ?? ''
        if (!aLoc && !bLoc) cmp = 0
        else if (!aLoc) return 1  // nulls always last
        else if (!bLoc) return -1
        else cmp = aLoc.localeCompare(bLoc)
      } else if (appSortKey === 'job') {
        const aJob = a.jobTitle ?? ''
        const bJob = b.jobTitle ?? ''
        if (!aJob && !bJob) cmp = 0
        else if (!aJob) return 1  // nulls always last
        else if (!bJob) return -1
        else cmp = aJob.localeCompare(bJob)
      } else if (appSortKey === 'date') {
        cmp = (a.appliedDate ?? '').localeCompare(b.appliedDate ?? '')
      } else if (appSortKey === 'status') {
        cmp = a.status.localeCompare(b.status)
      }
      return appSortDir === 'asc' ? cmp : -cmp
    })
  }, [appApplicants, appSearch, appStatusFilter, appSortKey, appSortDir, appRadiusMiles])

  function handleAppExpand(a: Applicant) {
    if (expandedId === a.id) {
      setExpandedId(null)
      setExpandedNotes('')
    } else {
      setExpandedId(a.id)
      setExpandedNotes(a.notes ?? '')
    }
  }

  async function handleAppStatusChange(id: string, status: ApplicantStatus) {
    setAppApplicants((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)))
    await fetch(`/api/applicants/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
  }

  async function handleNotesBlur(a: Applicant) {
    if (expandedNotes === (a.notes ?? '')) return
    const res = await fetch(`/api/applicants/${a.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: expandedNotes }),
    })
    if (res.ok) {
      setAppApplicants((prev) => prev.map((x) => (x.id === a.id ? { ...x, notes: expandedNotes } : x)))
    }
  }

  async function handlePromote(id: string) {
    setPromotingId(id)
    try {
      const res = await fetch(`/api/applicants/${id}/promote`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setPromotedResult((prev) => ({ ...prev, [id]: json.data.stylistId }))
        setAppApplicants((prev) => prev.filter((a) => a.id !== id))
        toast('Promoted to stylist!', 'success')
      } else {
        toast(typeof json.error === 'string' ? json.error : 'Promote failed', 'error')
      }
    } catch {
      toast('Network error', 'error')
    } finally {
      setPromotingId(null)
    }
  }

  async function handleAppImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportingCSV(true)
    setImportBanner(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/applicants/import', { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setImportBanner({ imported: json.data.imported, skipped: json.data.skipped })
        const refresh = await fetch('/api/applicants')
        const rj = await refresh.json().catch(() => ({}))
        if (rj.data?.applicants) setAppApplicants(rj.data.applicants)
        toast(`Imported ${json.data.imported} applicant${json.data.imported !== 1 ? 's' : ''}`, 'success')
      } else {
        toast(typeof json.error === 'string' ? json.error : 'Import failed', 'error')
      }
    } catch {
      toast('Import failed', 'error')
    } finally {
      setImportingCSV(false)
      if (appFileInputRef.current) appFileInputRef.current.value = ''
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  function handleFindDuplicates() {
    if (dupMode) {
      setDupMode(false)
      setSelected(new Set())
    } else {
      setDupMode(true)
      setSelected(new Set(dupInfo.dupSelectIds))
    }
  }

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function handleAppSort(key: typeof appSortKey) {
    if (appSortKey === key) {
      setAppSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setAppSortKey(key)
      setAppSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortKey === 'code') {
        const cmp = (a.stylistCode ?? '').localeCompare(b.stylistCode ?? '', undefined, { sensitivity: 'base' })
        return sortDir === 'asc' ? cmp : -cmp
      } else if (sortKey === 'name') {
        const aLast = (a.name ?? '').split(' ').pop() ?? ''
        const bLast = (b.name ?? '').split(' ').pop() ?? ''
        const cmp = aLast.localeCompare(bLast, undefined, { sensitivity: 'base' })
        return sortDir === 'asc' ? cmp : -cmp
      } else if (sortKey === 'facility') {
        const aVal = facilityById.get(a.facilityId ?? '') ?? 'Franchise Pool'
        const bVal = facilityById.get(b.facilityId ?? '') ?? 'Franchise Pool'
        const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: 'base' })
        return sortDir === 'asc' ? cmp : -cmp
      } else if (sortKey === 'status') {
        const cmp = (a.status ?? 'active').localeCompare(b.status ?? 'active', undefined, { sensitivity: 'base' })
        return sortDir === 'asc' ? cmp : -cmp
      } else {
        const diff = (a.commissionPercent ?? 0) - (b.commissionPercent ?? 0)
        return sortDir === 'asc' ? diff : -diff
      }
    })
  }, [filtered, sortKey, sortDir, facilityById])

  // Keep selectAll checkbox indeterminate state in sync
  const allVisibleSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id))
  const someSelected = filtered.some((s) => selected.has(s.id))
  if (selectAllRef.current) {
    selectAllRef.current.indeterminate = someSelected && !allVisibleSelected
  }

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        filtered.forEach((s) => next.delete(s.id))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        filtered.forEach((s) => next.add(s.id))
        return next
      })
    }
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  const handleDeleteSingle = async (id: string, name: string) => {
    if (!window.confirm(`Delete ${name}?`)) return
    const res = await fetch(`/api/stylists/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setStylists((prev) => prev.filter((s) => s.id !== id))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } else {
      toast('Failed to delete', 'error')
    }
  }

  const handleBulkDelete = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    if (!window.confirm(`Delete ${ids.length} stylist${ids.length !== 1 ? 's' : ''}?`)) return
    setDeletingBulk(true)
    try {
      const res = await fetch('/api/stylists/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        const deletedSet = new Set(ids)
        setStylists((prev) => prev.filter((s) => !deletedSet.has(s.id)))
        setSelected(new Set())
        toast(`${json.data?.deleted ?? ids.length} deleted`, 'success')
      } else {
        toast(typeof json.error === 'string' ? json.error : 'Delete failed', 'error')
      }
    } catch {
      toast('Delete failed', 'error')
    } finally {
      setDeletingBulk(false)
    }
  }

  const handleBulkUpdate = async () => {
    if (!bulkStatusValue && !bulkFacilityId && bulkCommission === '') return
    setApplyingBulk(true)
    try {
      const body: Record<string, unknown> = { ids: Array.from(selected) }
      if (bulkStatusValue) body.status = bulkStatusValue
      if (bulkFacilityId) body.facilityId = bulkFacilityId
      if (bulkCommission !== '') body.commissionPercent = Number(bulkCommission)
      const res = await fetch('/api/stylists/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast(typeof json.error === 'string' ? json.error : 'Update failed', 'error')
        return
      }
      setStylists((prev) =>
        prev.map((s) => {
          if (!selected.has(s.id)) return s
          const updates: Partial<Stylist> = {}
          if (bulkStatusValue) updates.status = bulkStatusValue as StylistStatus
          if (bulkFacilityId) updates.facilityId = bulkFacilityId
          if (bulkCommission !== '') updates.commissionPercent = Number(bulkCommission)
          return { ...s, ...updates }
        }),
      )
      setSelected(new Set())
      setBulkStatusValue('')
      setBulkFacilityId('')
      setBulkCommission('')
      toast(`Updated ${json.data?.updated ?? selected.size} stylist(s)`, 'success')
    } catch {
      toast('Update failed', 'error')
    } finally {
      setApplyingBulk(false)
    }
  }

  return (
    <div className="page-enter p-6 max-w-5xl mx-auto pb-32">
      {/* Tab switcher */}
      <div className="flex rounded-xl border border-stone-200 overflow-hidden bg-white w-fit mb-6">
        {(['stylists', 'applicants'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === tab ? 'text-white' : 'text-stone-600 hover:bg-stone-50'
            }`}
            style={activeTab === tab ? { backgroundColor: '#8B2E4A' } : undefined}
          >
            {tab === 'stylists' ? 'Stylists' : 'Applicants'}
            {tab === 'applicants' && appApplicants.length > 0 && (
              <span className={`text-xs font-semibold ${activeTab === 'applicants' ? 'text-white/80' : 'text-stone-400'}`}>
                •{appApplicants.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ─── Stylists tab ─────────────────────────────────────────────────── */}
      {activeTab === 'stylists' && (
      <>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-2xl font-normal text-stone-900"
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
            type="button"
            onClick={handleFindDuplicates}
            className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
              dupMode
                ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                : 'border-stone-200 text-stone-700 hover:bg-stone-50'
            }`}
          >
            {dupMode ? 'Clear' : 'Find Duplicates'}
          </button>
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
          onChange={(e) => { setSearch(e.target.value); setSelected(new Set()) }}
          placeholder="Search by name or ST code"
          className="flex-1 min-w-[240px] px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:shadow-[0_0_0_3px_rgba(139,46,74,0.08)] transition-all"
        />
        <div className="flex rounded-xl border border-stone-200 overflow-hidden bg-white">
          {(['all', 'assigned', 'unassigned'] as Filter[]).map((k) => (
            <button
              key={k}
              onClick={() => { setFilter(k); setSelected(new Set()) }}
              className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${
                filter === k ? 'text-white' : 'text-stone-600 hover:bg-stone-50'
              }`}
              style={filter === k ? { backgroundColor: '#8B2E4A' } : undefined}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl border border-stone-200 overflow-hidden bg-white">
          {(
            [
              ['all', 'All'],
              ['active', 'Active'],
              ['on_leave', 'On Leave'],
              ['inactive', 'Inactive'],
            ] as Array<[StatusFilter, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => {
                setStatusFilter(k)
                setSelected(new Set())
              }}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                statusFilter === k ? 'text-white' : 'text-stone-600 hover:bg-stone-50'
              }`}
              style={statusFilter === k ? { backgroundColor: '#8B2E4A' } : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {addOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleAdd()
          }}
          className="mb-4 p-4 rounded-2xl bg-rose-50 border border-rose-100"
        >
          <p className="text-sm font-semibold text-stone-900 mb-3">Add Stylist</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-stone-600 block mb-1">Name *</label>
              <input
                autoFocus
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                maxLength={200}
                className="w-full px-3 py-2 rounded-xl border border-rose-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20"
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
                className="w-full px-3 py-2 rounded-xl border border-rose-200 text-sm bg-white font-mono focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20"
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
                className="w-full px-3 py-2 rounded-xl border border-rose-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-stone-600 block mb-1">Facility</label>
              <select
                value={addFacilityId}
                onChange={(e) => setAddFacilityId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-rose-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20"
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
              type="submit"
              disabled={!addName.trim() || addSubmitting}
              className="px-4 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
              style={{ backgroundColor: '#8B2E4A' }}
            >
              {addSubmitting ? 'Adding…' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAddOpen(false)
                setAddError(null)
              }}
              className="px-4 py-2 rounded-xl text-sm text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
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
                <span className="font-semibold">{importResult.updated}</span> updated
              </p>
              {importResult.availabilityCreated > 0 && (
                <p className="text-xs text-stone-600 mt-0.5">
                  {importResult.availabilityCreated} availability schedule{importResult.availabilityCreated !== 1 ? 's' : ''} created
                </p>
              )}
              {importResult.scheduleNotes > 0 && (
                <p className="text-xs text-amber-700 mt-0.5">
                  {importResult.scheduleNotes} schedule note{importResult.scheduleNotes !== 1 ? 's' : ''} saved (facility not matched)
                </p>
              )}
              {importResult.errors.length > 0 && (
                <p className="text-xs text-red-600 mt-0.5">
                  <span className="font-semibold">{importResult.errors.length}</span> error{importResult.errors.length !== 1 ? 's' : ''}
                </p>
              )}
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

      {dupMode && (
        <div
          className={`mb-4 px-4 py-3 rounded-xl text-sm border ${
            dupInfo.dupCodeCount > 0
              ? 'bg-red-50 border-red-200 text-red-700'
              : dupInfo.dupNameCount > 0
              ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-stone-50 border-stone-200 text-stone-600'
          }`}
        >
          {dupInfo.dupNameCount === 0 && dupInfo.dupCodeCount === 0
            ? 'No duplicates found.'
            : `${dupInfo.dupNameCount} duplicate name${dupInfo.dupNameCount !== 1 ? 's' : ''}, ${dupInfo.dupCodeCount} duplicate ST code${dupInfo.dupCodeCount !== 1 ? 's' : ''} found — ${dupInfo.dupSelectIds.size} selected for deletion`}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-12 text-center">
          <p className="text-stone-400 text-sm">No stylists match this filter.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {/* Select-all header */}
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-stone-100 bg-stone-50">
            <input
              type="checkbox"
              ref={(el) => {
                selectAllRef.current = el
                if (el) el.indeterminate = someSelected && !allVisibleSelected
              }}
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded accent-[#8B2E4A] shrink-0 cursor-pointer"
            />
            <span className="text-xs text-stone-500 font-medium">
              {someSelected
                ? `${selected.size} selected`
                : `${filtered.length} stylist${filtered.length !== 1 ? 's' : ''}`}
            </span>
          </div>

          {/* Sort header */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-stone-100 bg-stone-50/50">
            <div className="w-5 shrink-0" />
            {(
              [
                { key: 'code', label: 'ST Code', className: 'w-14 shrink-0' },
                { key: 'name', label: 'Last Name', className: 'flex-1 min-w-0' },
                { key: 'status', label: 'Status', className: 'w-20 shrink-0' },
                { key: 'facility', label: 'Facility', className: 'w-32 shrink-0' },
                { key: 'commission', label: 'Commission', className: 'w-24 shrink-0 text-right' },
              ] as const
            ).map((col) => (
              <button
                key={col.key}
                type="button"
                onClick={() => handleSort(col.key)}
                className={`${col.className} text-xs font-semibold text-stone-500 uppercase tracking-wide flex items-center gap-1 hover:text-stone-700 transition-colors`}
              >
                {col.label}
                {sortKey === col.key ? (
                  <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                ) : (
                  <span className="text-[10px] text-stone-300">↕</span>
                )}
              </button>
            ))}
            <div className="w-8 shrink-0" /> {/* delete button spacer */}
          </div>

          {sorted.map((s) => {
            const facility = s.facilityId ? facilityById.get(s.facilityId) : null
            const isSelected = selected.has(s.id)
            return (
              <div
                key={s.id}
                className={`flex items-center gap-2 px-4 py-3.5 border-b border-stone-50 last:border-0 transition-colors duration-[120ms] ease-out ${
                  dupMode && dupInfo.dupCodeIds.has(s.id)
                    ? 'bg-red-50'
                    : dupMode && dupInfo.dupNameIds.has(s.id)
                    ? 'bg-amber-50'
                    : isSelected
                    ? 'bg-rose-50'
                    : 'hover:bg-stone-50'
                }`}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(s.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 rounded accent-[#8B2E4A] shrink-0 cursor-pointer"
                />

                {/* Row content — clickable link */}
                <Link
                  href={`/stylists/${s.id}`}
                  className="flex items-center gap-3 flex-1 min-w-0"
                  onClick={(e) => {
                    // Don't navigate if clicking within the row but the checkbox was just used
                    if (isSelected) e.stopPropagation()
                  }}
                >
                  <span className="font-mono text-xs text-stone-500 w-14 shrink-0">
                    {s.stylistCode}
                  </span>
                  <Avatar name={s.name} color={s.color} size="md" />
                  <span className="text-[13.5px] font-semibold text-stone-900 leading-snug flex-1 min-w-0 truncate">
                    {s.name}
                  </span>
                  <span className="w-20 shrink-0 flex items-center">
                    {s.status !== 'active' && STATUS_BADGE[s.status as keyof typeof STATUS_BADGE] && (
                      <span
                        className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full ${
                          STATUS_BADGE[s.status as keyof typeof STATUS_BADGE].className
                        }`}
                      >
                        {STATUS_BADGE[s.status as keyof typeof STATUS_BADGE].label}
                      </span>
                    )}
                  </span>
                  {facility ? (
                    <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600 shrink-0">
                      {facility}
                    </span>
                  ) : (
                    <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-full bg-rose-50 text-[#8B2E4A] shrink-0">
                      Franchise Pool
                    </span>
                  )}
                  <span className="text-[11.5px] text-stone-500 shrink-0 hidden sm:inline">
                    {s.commissionPercent}%
                  </span>
                </Link>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleDeleteSingle(s.id, s.name)
                  }}
                  className="p-1.5 text-stone-300 hover:text-red-500 transition-colors shrink-0 rounded-lg hover:bg-red-50"
                  title="Delete stylist"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}

      </>
      )}

      {/* ─── Applicants tab ───────────────────────────────────────────────── */}
      {activeTab === 'applicants' && (
        <div>
          {/* Toolbar */}
          <div className="mb-4 flex flex-wrap gap-3 items-center">
            <input
              type="search"
              value={appSearch}
              onChange={(e) => setAppSearch(e.target.value)}
              placeholder="Search by name, email, location, or ZIP"
              className="flex-1 min-w-[240px] px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:shadow-[0_0_0_3px_rgba(139,46,74,0.08)] transition-all"
            />
            {/^\d{5}$/.test(appSearch.trim()) && (
              <select
                value={appRadiusMiles}
                onChange={(e) => setAppRadiusMiles(Number(e.target.value))}
                className="h-9 rounded-xl border border-stone-200 text-sm px-2 text-stone-700 bg-white shrink-0"
              >
                <option value={5}>5 miles</option>
                <option value={10}>10 miles</option>
                <option value={15}>15 miles</option>
                <option value={25}>25 miles</option>
                <option value={50}>50 miles</option>
              </select>
            )}
            <div className="flex rounded-xl border border-stone-200 overflow-hidden bg-white">
              <button
                type="button"
                onClick={() => setAppStatusFilter('all')}
                className={`px-3 py-2 text-xs font-medium transition-colors ${appStatusFilter === 'all' ? 'text-white' : 'text-stone-600 hover:bg-stone-50'}`}
                style={appStatusFilter === 'all' ? { backgroundColor: '#8B2E4A' } : undefined}
              >
                All{' '}
                <span className="opacity-60">({appApplicants.length})</span>
              </button>
              {APP_STATUS_LABELS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setAppStatusFilter(s)}
                  className={`px-3 py-2 text-xs font-medium capitalize transition-colors ${appStatusFilter === s ? 'text-white' : 'text-stone-600 hover:bg-stone-50'}`}
                  style={appStatusFilter === s ? { backgroundColor: '#8B2E4A' } : undefined}
                >
                  {s}{' '}
                  <span className="opacity-60">({appApplicants.filter((a) => a.status === s).length})</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => appFileInputRef.current?.click()}
              disabled={importingCSV}
              className="px-3 py-2 rounded-xl text-sm font-medium border border-stone-200 text-stone-700 hover:bg-stone-50 transition-colors disabled:opacity-50"
            >
              {importingCSV ? 'Importing…' : 'Import CSV'}
            </button>
            <input
              ref={appFileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleAppImport}
            />
          </div>

          {/* Import result banner */}
          {importBanner && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm flex items-center justify-between">
              <span>
                Imported{' '}
                <span className="font-semibold">{importBanner.imported}</span> new applicant{importBanner.imported !== 1 ? 's' : ''},{' '}
                <span className="font-semibold">{importBanner.skipped}</span> already existed.
              </span>
              <button type="button" onClick={() => setImportBanner(null)} className="ml-4 text-emerald-500 hover:text-emerald-700 text-lg leading-none">✕</button>
            </div>
          )}

          {/* List */}
          {filteredApplicants.length === 0 ? (
            <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-12 text-center">
              <p className="text-stone-400 text-sm">
                {appApplicants.length === 0
                  ? 'No applicants yet. Import a CSV from Indeed to get started.'
                  : 'No applicants match this filter.'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-[18px] border border-stone-200 shadow-[var(--shadow-sm)] overflow-hidden">
              {/* Sort header */}
              <div className="grid grid-cols-[1fr_140px_120px_100px_100px_32px] px-4 py-2 border-b border-stone-200 bg-stone-50/60">
                {(
                  [
                    { key: 'name', label: 'Name' },
                    { key: 'location', label: 'Location' },
                    { key: 'job', label: 'Job Applied For' },
                    { key: 'date', label: 'Date Applied' },
                    { key: 'status', label: 'Status' },
                  ] as const
                ).map((col) => (
                  <button
                    key={col.key}
                    type="button"
                    onClick={() => handleAppSort(col.key)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-stone-400 uppercase tracking-wide hover:text-stone-600 transition-colors text-left"
                  >
                    {col.label}
                    {appSortKey === col.key ? (
                      <span className="text-[10px]">{appSortDir === 'asc' ? '↑' : '↓'}</span>
                    ) : (
                      <span className="text-[10px] text-stone-300">↕</span>
                    )}
                  </button>
                ))}
                <div />
              </div>
              {filteredApplicants.map((a) => (
                <div key={a.id} className="group border-b border-stone-50 last:border-0 hover:bg-[#F9EFF2] transition-colors duration-[120ms] ease-out">
                  {/* Summary row */}
                  <div
                    className="grid grid-cols-[1fr_140px_120px_100px_100px_32px] items-center px-4 py-3.5 cursor-pointer"
                    onClick={() => handleAppExpand(a)}
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-sm font-semibold text-stone-900 truncate">{a.name}</p>
                    </div>
                    <span
                      className="text-xs text-stone-500 truncate pr-2"
                      title={a.location ?? undefined}
                    >
                      {a.location ?? <span className="text-stone-300">—</span>}
                    </span>
                    <span
                      className="text-xs text-stone-500 truncate pr-2"
                      title={a.jobTitle ?? undefined}
                    >
                      {a.jobTitle ?? <span className="text-stone-300">—</span>}
                    </span>
                    <span className="text-xs text-stone-400 truncate pr-2">
                      {a.appliedDate ? formatAppliedDate(a.appliedDate) : <span className="text-stone-300">—</span>}
                    </span>
                    <div onClick={(e) => e.stopPropagation()}>
                      <select
                        value={a.status}
                        onChange={(e) => { e.stopPropagation(); handleAppStatusChange(a.id, e.target.value as ApplicantStatus) }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs border border-stone-200 rounded-lg px-1.5 py-0.5 bg-white text-stone-600 capitalize"
                      >
                        {APP_STATUS_LABELS.map((s) => (
                          <option key={s} value={s} className="capitalize">{s}</option>
                        ))}
                      </select>
                    </div>
                    <span
                      className="p-1.5 text-stone-400 justify-self-end"
                      aria-hidden="true"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className={`transition-transform ${expandedId === a.id ? 'rotate-180' : ''}`}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </span>
                  </div>

                  {/* Expanded detail panel */}
                  {expandedId === a.id && (
                    <div className="px-4 pb-5 pt-1 bg-stone-50 border-t border-stone-100 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {a.email && (
                          <div>
                            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">Email</p>
                            <p className="text-sm break-all flex items-center gap-1.5">
                              <a
                                href={`mailto:${a.email}`}
                                className="text-[#8B2E4A] underline underline-offset-2 hover:text-[#72253C]"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {a.email}
                              </a>
                              {a.isIndeedEmail && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 shrink-0">via Indeed</span>
                              )}
                            </p>
                          </div>
                        )}
                        {a.phone && (
                          <div>
                            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">Phone</p>
                            <p className="text-sm text-stone-700">{a.phone}</p>
                          </div>
                        )}
                        {a.jobTitle && (
                          <div>
                            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">Job Title</p>
                            <p className="text-sm text-stone-700">{a.jobTitle}</p>
                          </div>
                        )}
                        {a.jobLocation && (
                          <div>
                            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">Job Location</p>
                            <p className="text-sm text-stone-700">{a.jobLocation}</p>
                          </div>
                        )}
                        {a.education && (
                          <div>
                            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">Education</p>
                            <p className="text-sm text-stone-700">{a.education}</p>
                          </div>
                        )}
                        {a.source && (
                          <div>
                            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">Source</p>
                            <p className="text-sm text-stone-700">{a.source}</p>
                          </div>
                        )}
                      </div>
                      {a.relevantExperience && (
                        <div>
                          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-0.5">Experience</p>
                          <p className="text-sm text-stone-700 whitespace-pre-line">{a.relevantExperience}</p>
                        </div>
                      )}
                      {a.qualifications.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1.5">Qualifications</p>
                          <div className="space-y-1.5">
                            {a.qualifications.map((q, i) => (
                              <div key={i} className="text-sm">
                                <span className="text-stone-600 font-medium">{q.question}: </span>
                                {q.match && (
                                  <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded font-semibold ${q.match.toLowerCase() === 'yes' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                                    {q.match}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">Notes</p>
                        <textarea
                          value={expandedNotes}
                          onChange={(e) => setExpandedNotes(e.target.value)}
                          onBlur={() => handleNotesBlur(a)}
                          placeholder="Add internal notes…"
                          rows={3}
                          className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20"
                        />
                      </div>
                      <div className="flex items-center gap-3 pt-1">
                        {promotedResult[a.id] ? (
                          <Link
                            href={`/stylists/${promotedResult[a.id]}`}
                            className="text-sm font-medium text-emerald-700 underline underline-offset-2"
                          >
                            Promoted! View stylist profile →
                          </Link>
                        ) : a.status !== 'rejected' && (
                          <button
                            type="button"
                            onClick={() => handlePromote(a.id)}
                            disabled={promotingId === a.id}
                            className="px-3 py-1.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
                            style={{ backgroundColor: '#8B2E4A' }}
                          >
                            {promotingId === a.id ? 'Promoting…' : 'Promote to Stylist →'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-40 flex flex-wrap items-center gap-2 px-4 py-3 rounded-2xl bg-white border border-stone-200 shadow-lg max-w-[calc(100vw-32px)]"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}
        >
          <span className="text-sm font-medium text-stone-700 shrink-0">
            {selected.size} selected
          </span>

          <select
            value={bulkStatusValue}
            onChange={(e) => {
              setBulkStatusValue(e.target.value as StylistStatus | '')
              setBulkFacilityId('')
              setBulkCommission('')
            }}
            className="h-8 rounded-lg border border-stone-200 text-sm px-2 text-stone-700 bg-white"
          >
            <option value="">Set status…</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="on_leave">On Leave</option>
            <option value="terminated">Terminated</option>
          </select>

          <select
            value={bulkFacilityId}
            onChange={(e) => {
              setBulkFacilityId(e.target.value)
              setBulkStatusValue('')
              setBulkCommission('')
            }}
            className="h-8 rounded-lg border border-stone-200 text-sm px-2 text-stone-700 bg-white"
          >
            <option value="">Set facility…</option>
            {franchiseFacilities.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>

          <input
            type="number"
            min={0}
            max={100}
            placeholder="Set commission %"
            value={bulkCommission}
            onChange={(e) => {
              setBulkCommission(e.target.value)
              setBulkStatusValue('')
              setBulkFacilityId('')
            }}
            className="h-8 w-36 rounded-lg border border-stone-200 text-sm px-2 text-stone-700"
          />

          <button
            onClick={handleBulkUpdate}
            disabled={applyingBulk || (!bulkStatusValue && !bulkFacilityId && bulkCommission === '')}
            className="px-3 py-1.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 transition-colors"
            style={{ backgroundColor: '#8B2E4A' }}
          >
            {applyingBulk ? 'Applying…' : 'Apply'}
          </button>

          <button
            onClick={handleBulkDelete}
            disabled={deletingBulk}
            className="px-3 py-1.5 rounded-xl text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 transition-colors"
          >
            {deletingBulk ? 'Deleting…' : 'Delete'}
          </button>

          <button
            onClick={() => setSelected(new Set())}
            className="px-3 py-1.5 rounded-xl text-sm text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
