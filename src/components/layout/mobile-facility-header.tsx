'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { BottomSheet } from '@/components/ui/bottom-sheet'

interface FacilityOption {
  id: string
  name: string
  facilityCode?: string | null
  role: string
}

interface MobileFacilityHeaderProps {
  facilityName?: string
  facilityCode?: string | null
  allFacilities: FacilityOption[]
  role: string
  debugMode?: boolean
}

export function MobileFacilityHeader({
  facilityName,
  facilityCode,
  allFacilities,
  role,
  debugMode = false,
}: MobileFacilityHeaderProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [switching, setSwitching] = useState(false)
  const [facilitySortOrder, setFacilitySortOrder] = useState<'fid' | 'name'>(() => {
    if (typeof window === 'undefined') return 'fid'
    return (localStorage.getItem('facilitySortOrder') as 'fid' | 'name') ?? 'fid'
  })

  const showSwitcher = allFacilities.length > 1 && role === 'admin'

  const sortedFacilities = useMemo(() => {
    return [...allFacilities].sort((a, b) => {
      if (facilitySortOrder === 'name') return (a.name ?? '').localeCompare(b.name ?? '')
      const numA = parseInt(a.facilityCode?.replace(/\D/g, '') ?? '9999', 10)
      const numB = parseInt(b.facilityCode?.replace(/\D/g, '') ?? '9999', 10)
      return numA - numB
    })
  }, [allFacilities, facilitySortOrder])

  const filtered = useMemo(() => {
    if (!search.trim()) return sortedFacilities
    const q = search.toLowerCase()
    return sortedFacilities.filter(
      (f) => f.name?.toLowerCase().includes(q) || f.facilityCode?.toLowerCase().includes(q)
    )
  }, [sortedFacilities, search])

  const handleSelect = async (facilityId: string) => {
    setSwitching(true)
    setOpen(false)
    await fetch('/api/facilities/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilityId }),
    })
    router.refresh()
    setSwitching(false)
  }

  return (
    <>
      <div
        className="md:hidden flex items-center justify-between px-4 shrink-0 border-b border-stone-100 bg-white"
        style={{ minHeight: 'var(--app-header-height)', paddingTop: 'var(--app-safe-top)' }}
      >
        <Link href="/dashboard">
          <Image
            src="/seniorstylistlogo.jpg"
            alt="Senior Stylist"
            width={110}
            height={44}
            style={{ objectFit: 'contain', height: 36, width: 'auto' }}
          />
        </Link>
        <div className="flex items-center gap-2">
          {debugMode && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide">
              Debug
            </span>
          )}
          {showSwitcher ? (
            <button
              onClick={() => setOpen(true)}
              disabled={switching}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-stone-100 text-stone-700 text-xs font-medium max-w-[160px]"
            >
              {facilityCode && (
                <span className="font-mono text-stone-500 shrink-0">{facilityCode}</span>
              )}
              <span className="truncate">{facilityName ?? 'Select'}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          ) : facilityName ? (
            <div className="flex items-center gap-1.5 text-xs text-stone-500 max-w-[160px]">
              {facilityCode && <span className="font-mono shrink-0">{facilityCode}</span>}
              <span className="truncate">{facilityName}</span>
            </div>
          ) : null}
        </div>
      </div>

      <BottomSheet isOpen={open} onClose={() => { setOpen(false); setSearch('') }} title="Switch Facility">
        {/* Sort toggle */}
        <div className="flex items-center gap-1.5 px-4 pt-3 pb-3 border-b border-stone-100">
          <span className="text-xs text-stone-400">Sort:</span>
          {(['fid', 'name'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => {
                setFacilitySortOrder(opt)
                localStorage.setItem('facilitySortOrder', opt)
              }}
              className="px-2.5 py-0.5 rounded-full text-xs transition-colors"
              style={{
                backgroundColor: facilitySortOrder === opt ? '#8B2E4A' : '#f5f5f4',
                color: facilitySortOrder === opt ? 'white' : '#78716c',
                fontWeight: facilitySortOrder === opt ? '600' : '400',
              }}
            >
              {opt === 'fid' ? 'FID' : 'A–Z'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search facilities…"
            className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:border-[#8B2E4A]/40"
            style={{ '--tw-ring-color': 'rgba(139,46,74,0.2)' } as React.CSSProperties}
          />
        </div>

        {/* Facility list */}
        <div className="pb-safe">
          {filtered.map((f) => (
            <button
              key={f.id}
              onClick={() => handleSelect(f.id)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm transition-colors active:bg-stone-100"
              style={{ color: f.name === facilityName ? '#8B2E4A' : '#1c1917' }}
            >
              {f.facilityCode && (
                <span className="font-mono text-xs text-stone-400 shrink-0 w-12">{f.facilityCode}</span>
              )}
              <span className="flex-1 truncate">{f.name}</span>
              {f.name === facilityName && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0" style={{ color: '#8B2E4A' }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-sm text-stone-400 text-center">No facilities match "{search}"</p>
          )}
        </div>
      </BottomSheet>
    </>
  )
}
