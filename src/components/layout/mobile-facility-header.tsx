'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { BottomSheet } from '@/components/ui/bottom-sheet'
import { loadFacilitySortOrder, saveFacilitySortOrder, sortFacilitiesForSwitcher, filterFacilitiesForSwitcher, switchFacility, type FacilitySortOrder } from '@/lib/facility-switch'
import { NotificationBell } from '@/components/notifications/notification-bell'

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
  const [facilitySortOrder, setFacilitySortOrder] = useState<FacilitySortOrder>(loadFacilitySortOrder)

  const showSwitcher = allFacilities.length > 1 && (role === 'admin' || role === 'bookkeeper')

  const sortedFacilities = useMemo(
    () => sortFacilitiesForSwitcher(allFacilities, facilitySortOrder),
    [allFacilities, facilitySortOrder]
  )

  const filtered = useMemo(
    () => filterFacilitiesForSwitcher(sortedFacilities, search),
    [sortedFacilities, search]
  )

  const handleSelect = async (facilityId: string) => {
    setSwitching(true)
    setOpen(false)
    await switchFacility(facilityId) // shared select + HARD reload (Phase 25)
  }

  return (
    <>
      <div
        className="md:hidden flex items-center justify-between px-4 shrink-0 border-b border-stone-100 bg-white"
        style={{ minHeight: 'var(--app-header-height)', paddingTop: 'var(--app-safe-top)' }}
      >
        <Link href="/dashboard" data-tour-mobile="mobile-home-logo">
          <Image
            src="/seniorstylistlogo.jpg"
            alt="Senior Stylist"
            width={110}
            height={44}
            style={{ objectFit: 'contain', height: 36, width: 'auto' }}
          />
        </Link>
        <div className="flex items-center gap-0.5">
          {/* P47 — mobile palette entry (all roles except viewer). */}
          {role !== 'viewer' && (
            <button
              type="button"
              aria-label="Search"
              onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
              className="w-9 h-9 flex items-center justify-center rounded-full text-stone-500 active:bg-stone-100 transition-colors"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          )}
          {/* P47 — the AI assistant moved from the floating bubble into the
              header (Josh's pick). Keep data-tour-mobile in sync with the
              widget's data-tour anchor — the meet-assistant tour resolves it. */}
          <button
            type="button"
            aria-label="AI assistant"
            data-tour-mobile="assistant-button"
            onClick={() => window.dispatchEvent(new CustomEvent('open-assistant'))}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[#8B2E4A] active:bg-[#F9EFF2] transition-colors"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l1.9 5.7a2 2 0 001.3 1.3L21 12l-5.8 1.9a2 2 0 00-1.3 1.3L12 21l-1.9-5.8a2 2 0 00-1.3-1.3L3 12l5.8-2a2 2 0 001.3-1.3L12 3z" />
            </svg>
          </button>
          <div className="w-1" />
          <NotificationBell anchor="mobile" />
          {debugMode && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('open-mobile-debug'))}
              className="ml-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wide"
            >
              Debug
            </button>
          )}
          {showSwitcher ? (
            <button
              onClick={() => setOpen(true)}
              disabled={switching}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-stone-100 text-stone-700 text-xs font-medium max-w-[32vw]"
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
            <div className="flex items-center gap-1.5 text-xs text-stone-500 max-w-[32vw]">
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
                saveFacilitySortOrder(opt)
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
        <div>
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
