'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Facility {
  id: string
  name: string
  facilityCode: string | null
}

interface DebugTabProps {
  facilities: Facility[]
}

export function DebugTab({ facilities }: DebugTabProps) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState<'admin' | 'stylist' | null>(null)
  const [currentDebug, setCurrentDebug] = useState<{ role: string; facilityName: string } | null>(null)

  const eligible = facilities.filter((f) => f.facilityCode)

  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)__debug_role=([^;]*)/)
    if (match) {
      try { setCurrentDebug(JSON.parse(decodeURIComponent(match[1]))) } catch { /* ignore */ }
    }
  }, [])

  const selected = eligible.find((f) => f.id === selectedId)

  const handleImpersonate = async (role: 'admin' | 'stylist') => {
    if (!selected) return
    setLoading(role)
    try {
      const res = await fetch('/api/debug/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, facilityId: selected.id, facilityName: selected.name }),
      })
      if (res.ok) {
        router.push('/dashboard')
      }
    } finally {
      setLoading(null)
    }
  }

  const handleReset = async () => {
    await fetch('/api/debug/reset', { method: 'POST' })
    setCurrentDebug(null)
    router.refresh()
  }

  const handleOpenPortal = () => {
    if (!selected?.facilityCode) return
    window.open(`/family/${encodeURIComponent(selected.facilityCode)}`, '_blank')
  }

  const rows: { role: 'admin' | 'stylist' | 'portal'; label: string; desc: string }[] = [
    { role: 'admin', label: 'Admin View', desc: 'Full admin access — residents, billing, settings, reports' },
    { role: 'stylist', label: 'Stylist View', desc: 'Calendar + daily log only; no residents or billing' },
    { role: 'portal', label: 'Family Portal', desc: 'Opens the family portal in a new tab (no impersonation cookie)' },
  ]

  return (
    <div className="mt-4 space-y-6">
      {currentDebug && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <p className="text-sm font-medium text-amber-800">
            Currently impersonating: <span className="font-semibold">{currentDebug.role}</span> at{' '}
            <span className="font-semibold">{currentDebug.facilityName}</span>
          </p>
          <button
            onClick={handleReset}
            className="ml-4 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-400 text-amber-950 hover:bg-amber-500 transition-colors"
          >
            Reset to Master
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-stone-800 mb-1">Select Facility</h2>
        <p className="text-xs text-stone-500 mb-3">Only facilities with a facility code can be previewed.</p>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
        >
          <option value="">Select a facility…</option>
          {eligible.map((f) => (
            <option key={f.id} value={f.id}>
              {f.facilityCode} · {f.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        {rows.map(({ role, label, desc }) => (
          <div key={role} className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-900">{label}</p>
              <p className="text-xs text-stone-500 mt-0.5">{desc}</p>
            </div>
            <button
              onClick={() => {
                if (role === 'portal') handleOpenPortal()
                else handleImpersonate(role)
              }}
              disabled={!selectedId || (role !== 'portal' && loading !== null) || (role === 'portal' && !selected?.facilityCode)}
              className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#8B2E4A' }}
              onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#72253C' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#8B2E4A' }}
            >
              {role !== 'portal' && loading === role ? 'Loading…' : role === 'portal' ? 'Open →' : 'Enter'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
