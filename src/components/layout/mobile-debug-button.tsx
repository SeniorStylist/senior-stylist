'use client'

import { useState, useEffect } from 'react'
import { BottomSheet } from '@/components/ui/bottom-sheet'

interface FacilityOption {
  id: string
  name: string
  facilityCode?: string | null
  role: string
}

type DebugRole = 'admin' | 'facility_staff' | 'bookkeeper' | 'stylist'

const ROLE_LABELS: Record<DebugRole, string> = {
  admin: 'Admin',
  facility_staff: 'Facility Staff',
  bookkeeper: 'Bookkeeper',
  stylist: 'Stylist',
}

interface MobileDebugButtonProps {
  isMaster: boolean
  allFacilities: FacilityOption[]
  currentFacilityId: string
}

export function MobileDebugButton({ isMaster, allFacilities, currentFacilityId }: MobileDebugButtonProps) {
  const [open, setOpen] = useState(false)
  const [debugInfo, setDebugInfo] = useState<{ role: string; facilityId: string; facilityName: string } | null>(null)
  const [selectedRole, setSelectedRole] = useState<DebugRole>('admin')
  const [selectedFacilityId, setSelectedFacilityId] = useState(currentFacilityId)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)__debug_role=([^;]*)/)
    if (match) {
      try {
        setDebugInfo(JSON.parse(decodeURIComponent(match[1])))
      } catch { /* ignore */ }
    }
  }, [])

  if (!isMaster) return null

  const handleImpersonate = async () => {
    const facility = allFacilities.find((f) => f.id === selectedFacilityId)
    if (!facility) return
    setLoading(true)
    await fetch('/api/debug/impersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: selectedRole, facilityId: selectedFacilityId, facilityName: facility.name }),
    })
    window.location.href = '/dashboard'
  }

  const handleReset = async () => {
    setLoading(true)
    await fetch('/api/debug/reset', { method: 'POST' })
    window.location.href = '/master-admin'
  }

  return (
    <>
      {/* Floating indicator / trigger — mobile only. Phase 12Y: lives inside
          <main> so .main-content's transform-induced containing block lets us
          use plain `bottom-4` (sits above the nav naturally). */}
      {debugInfo ? (
        <div
          className="md:hidden fixed left-4 bottom-4 z-50 flex items-center gap-1.5 bg-amber-400 text-amber-950 text-xs font-bold px-3 py-2 rounded-2xl shadow-xl"
        >
          <span className="text-amber-800 text-[10px] font-semibold uppercase tracking-wide">Debug</span>
          <span>{ROLE_LABELS[debugInfo.role as DebugRole] ?? debugInfo.role}</span>
          <button
            onClick={() => setOpen(true)}
            className="ml-1 underline text-amber-900 text-[11px]"
          >
            change
          </button>
          <button
            onClick={handleReset}
            className="ml-1 bg-amber-950/10 hover:bg-amber-950/20 px-1.5 py-0.5 rounded-lg text-[11px] transition-colors"
          >
            exit
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="md:hidden fixed left-4 bottom-4 z-50 bg-[#8B2E4A] text-white text-[11px] font-bold px-3 py-1.5 rounded-full shadow-lg"
        >
          Debug
        </button>
      )}

      <BottomSheet isOpen={open} onClose={() => setOpen(false)} title="Debug Mode">
        <div className="px-4 py-4 space-y-5">
          {debugInfo && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
              <span className="font-semibold">Active:</span>{' '}
              {ROLE_LABELS[debugInfo.role as DebugRole] ?? debugInfo.role} · {debugInfo.facilityName}
            </div>
          )}

          {/* Role picker */}
          <div>
            <p className="text-xs font-semibold text-stone-500 mb-2">Role</p>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ROLE_LABELS) as DebugRole[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setSelectedRole(r)}
                  className="px-3 py-1.5 rounded-full text-sm transition-colors"
                  style={{
                    backgroundColor: selectedRole === r ? '#8B2E4A' : '#f5f5f4',
                    color: selectedRole === r ? 'white' : '#44403c',
                    fontWeight: selectedRole === r ? '600' : '400',
                  }}
                >
                  {ROLE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          {/* Facility picker */}
          <div>
            <p className="text-xs font-semibold text-stone-500 mb-2">Facility</p>
            <select
              value={selectedFacilityId}
              onChange={(e) => setSelectedFacilityId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-xl focus:outline-none bg-white"
            >
              <option value="">Select a facility…</option>
              {allFacilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.facilityCode ? `[${f.facilityCode}] ` : ''}{f.name}
                </option>
              ))}
            </select>
          </div>

          {/* Impersonate */}
          <button
            onClick={handleImpersonate}
            disabled={!selectedFacilityId || loading}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ backgroundColor: selectedFacilityId && !loading ? '#8B2E4A' : '#d6d3d1' }}
          >
            Impersonate
          </button>

          {/* Exit debug */}
          {debugInfo && (
            <button
              onClick={handleReset}
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold bg-amber-50 text-amber-800 border border-amber-200 transition-colors active:bg-amber-100"
            >
              ← Exit Debug Mode
            </button>
          )}
        </div>
      </BottomSheet>
    </>
  )
}
