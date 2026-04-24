'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { SkeletonResidentRow } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { cn, formatCents, formatDate } from '@/lib/utils'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'
import type { Resident } from '@/types'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { useToast } from '@/components/ui/toast'
import { MergeDuplicatesModal } from './merge-duplicates-modal'

interface ResidentWithStats extends Resident {
  lastVisit: string | null
  totalSpent: number
  appointmentCount: number
}

interface ResidentsPageClientProps {
  residents: ResidentWithStats[]
  facilityId: string
}

export function ResidentsPageClient({ residents: initialResidents, facilityId }: ResidentsPageClientProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [residents, setResidents] = useState(initialResidents)
  const [search, setSearch] = useState('')

  const { refreshing: pullRefreshing, pullProgress, handlers: pullHandlers } = usePullToRefresh(
    () => router.refresh()
  )
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [showMerge, setShowMerge] = useState(false)
  const [dupeCount, setDupeCount] = useState(0)

  // Fetch duplicate count on mount (fire-and-forget)
  useEffect(() => {
    fetch('/api/residents/duplicates')
      .then(r => r.json())
      .then(json => {
        const pairs: unknown[] = json.data?.pairs ?? []
        // Filter out dismissed pairs from localStorage
        try {
          const raw = localStorage.getItem(`dismissed-duplicate-pairs-${facilityId}`)
          const dismissed: string[] = raw ? JSON.parse(raw) : []
          setDupeCount(pairs.length - dismissed.length)
        } catch {
          setDupeCount(pairs.length)
        }
      })
      .catch(() => {})
  }, [facilityId])

  const handleDupeCountChange = useCallback((count: number) => {
    setDupeCount(Math.max(0, count))
  }, [])

  const [sortKey, setSortKey] = useState<'name' | 'room' | 'lastVisit' | 'totalSpent'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const filtered = residents
    .filter(
      (r) =>
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        (r.roomNumber && r.roomNumber.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sortKey === 'room') {
        if (!a.roomNumber && !b.roomNumber) cmp = 0
        else if (!a.roomNumber) cmp = 1
        else if (!b.roomNumber) cmp = -1
        else cmp = a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
      } else if (sortKey === 'lastVisit') {
        if (!a.lastVisit && !b.lastVisit) cmp = 0
        else if (!a.lastVisit) cmp = 1
        else if (!b.lastVisit) cmp = -1
        else cmp = new Date(a.lastVisit).getTime() - new Date(b.lastVisit).getTime()
      } else if (sortKey === 'totalSpent') {
        cmp = a.totalSpent - b.totalSpent
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

  const handleAdd = async () => {
    if (!name.trim()) { setAddError('Name is required'); return }
    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch('/api/residents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          roomNumber: roomNumber.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setResidents([{ ...json.data, lastVisit: null, totalSpent: 0, appointmentCount: 0 }, ...residents])
        setName('')
        setRoomNumber('')
        setPhone('')
        setShowAdd(false)
        toast('Resident added', 'success')
      } else {
        setAddError(json.error ?? 'Failed to add resident')
      }
    } catch {
      setAddError('Network error')
    } finally {
      setAdding(false)
    }
  }

  return (
    <ErrorBoundary>
    <div className="page-enter p-6 max-w-4xl mx-auto" {...pullHandlers}>
      {/* Pull-to-refresh indicator */}
      {(pullProgress > 0 || pullRefreshing) && (
        <div
          className="flex items-center justify-center mb-3 transition-all"
          style={{ height: pullRefreshing ? 36 : Math.min(pullProgress / 64, 1) * 36 }}
        >
          <svg
            className={pullRefreshing ? 'animate-spin' : ''}
            style={{ transform: pullRefreshing ? undefined : `rotate(${Math.min(pullProgress / 64, 1) * 360}deg)` }}
            width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2.5"
          >
            <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
        </div>
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-2xl font-normal text-stone-900"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Residents
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {residents.length} resident{residents.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowMerge(true)}
            className="relative flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-600 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors"
            title="Find duplicate residents"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="8" cy="12" r="4" />
              <circle cx="16" cy="12" r="4" />
            </svg>
            Duplicates
            {dupeCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-amber-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {dupeCount > 9 ? '9+' : dupeCount}
              </span>
            )}
          </button>
          <Link
            href="/residents/import"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-stone-600 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Import
          </Link>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="w-9 h-9 shrink-0 flex items-center justify-center bg-[#8B2E4A] text-white rounded-xl hover:bg-[#72253C] active:scale-95 transition-all"
            title="Add resident"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-4 mb-4 space-y-3">
          <p className="text-sm font-semibold text-stone-700">New Resident</p>
          {addError && <p className="text-xs text-red-600">{addError}</p>}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Full name *"
            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
          />
          <div className="flex gap-2">
            <input
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              placeholder="Room #"
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone"
              className="flex-1 bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setAddError(null); setName(''); setRoomNumber(''); setPhone('') }} disabled={adding}>
              Cancel
            </Button>
            <Button size="sm" loading={adding} onClick={handleAdd}>
              Add
            </Button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or room..."
          className="w-full bg-white border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm placeholder:text-stone-400 focus:outline-none focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 focus:shadow-[0_0_0_3px_rgba(139,46,74,0.08)] transition-all shadow-sm"
        />
      </div>

      {/* List */}
      {pullRefreshing ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => <SkeletonResidentRow key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm">
          {search ? (
            <p className="text-sm text-stone-400 py-16 text-center">No matches found</p>
          ) : (
            <EmptyState
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87" />
                  <path d="M16 3.13a4 4 0 010 7.75" />
                </svg>
              }
              title="No residents yet"
              description="Add your first resident to get started."
              cta={{ label: 'Add Resident', onClick: () => setShowAdd(true) }}
            />
          )}
        </div>
      ) : (
        <div className="bg-white rounded-[18px] border border-stone-200 shadow-[var(--shadow-sm)] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-200 bg-stone-50/60">
            {(
              [
                { key: 'name', label: 'Resident', span: 'col-span-4' },
                { key: 'room', label: 'Room', span: 'col-span-2' },
                { key: 'lastVisit', label: 'Last visit', span: 'col-span-3' },
                { key: 'totalSpent', label: 'Total spent', span: 'col-span-2' },
              ] as const
            ).map(({ key, label, span }) => (
              <div key={key} className={span}>
                <button
                  onClick={() => toggleSort(key)}
                  className={cn(
                    'flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                    sortKey === key ? 'text-[#8B2E4A]' : 'text-stone-400 hover:text-stone-600'
                  )}
                >
                  {label}
                  {sortKey === key && (
                    <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </div>
            ))}
            <div className="col-span-1" />
          </div>

          {/* Rows */}
          {filtered.map((resident) => (
            <button
              key={resident.id}
              onClick={() => router.push(`/residents/${resident.id}`)}
              className="group w-full grid grid-cols-12 gap-4 items-center px-5 py-3.5 hover:bg-[#F9EFF2] transition-colors duration-[120ms] ease-out border-b border-stone-50 last:border-0 text-left"
            >
              <div className="col-span-4 flex items-center gap-3">
                <Avatar name={resident.name} size="sm" />
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium text-stone-900 truncate">{resident.name}</span>
                  {resident.poaName && (
                    <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-semibold bg-rose-50 text-[#8B2E4A]">
                      POA
                    </span>
                  )}
                </div>
              </div>
              <div className="col-span-2 text-sm text-stone-500">
                {resident.roomNumber ? `Room ${resident.roomNumber}` : '—'}
              </div>
              <div className="col-span-3 text-sm text-stone-500">
                {resident.lastVisit ? formatDate(resident.lastVisit) : 'Never'}
              </div>
              <div className="col-span-2 text-sm font-semibold text-stone-700">
                {resident.totalSpent > 0 ? formatCents(resident.totalSpent) : '—'}
              </div>
              <div className="col-span-1 flex justify-end">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-300">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
    <MergeDuplicatesModal
      open={showMerge}
      onClose={() => setShowMerge(false)}
      onMerged={() => router.refresh()}
      facilityId={facilityId}
      onCountChange={handleDupeCountChange}
    />
    </ErrorBoundary>
  )
}
