'use client'

import { useEffect, useState } from 'react'

interface Facility {
  id: string
  name: string
  facilityCode: string | null
}

interface DebugTabProps {
  facilities: Facility[]
  currentFacilityId: string
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Facility Admin',
  super_admin: 'Franchise Admin',
  facility_staff: 'Facility Staff',
  bookkeeper: 'Bookkeeper',
  stylist: 'Stylist',
}

type DebugRole = 'admin' | 'super_admin' | 'facility_staff' | 'bookkeeper' | 'stylist'

export function DebugTab({ facilities, currentFacilityId }: DebugTabProps) {
  const eligible = facilities.filter((f) => f.facilityCode)
  const [selectedId, setSelectedId] = useState(() =>
    eligible.some((f) => f.id === currentFacilityId) ? currentFacilityId : ''
  )
  const [loading, setLoading] = useState<DebugRole | null>(null)
  const [currentDebug, setCurrentDebug] = useState<{ role: string; facilityName: string } | null>(null)
  // P30 — impersonate AS a specific stylist so the lockdown + ownership checks
  // behave exactly like the real account (Done/No-show, walk-in lock, own-only log).
  const [facilityStylists, setFacilityStylists] = useState<{ id: string; name: string }[]>([])
  const [selectedStylistId, setSelectedStylistId] = useState('')

  useEffect(() => {
    const readCookie = () => {
      const match = document.cookie.match(/(?:^|;\s*)__debug_role=([^;]*)/)
      if (match) {
        try { setCurrentDebug(JSON.parse(decodeURIComponent(match[1]))) } catch { /* ignore */ }
      } else {
        setCurrentDebug(null)
      }
    }
    readCookie()
    document.addEventListener('visibilitychange', readCookie)
    return () => document.removeEventListener('visibilitychange', readCookie)
  }, [])

  const selected = eligible.find((f) => f.id === selectedId)

  // Load the facility's stylist roster (home + assignment-linked) for the
  // stylist picker whenever the selected facility changes.
  useEffect(() => {
    setFacilityStylists([])
    setSelectedStylistId('')
    if (!selectedId) return
    const ctrl = new AbortController()
    fetch(`/api/log/ocr/rosters?facilityId=${selectedId}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => {
        const list = (j?.data?.stylists ?? []) as { id: string; name: string }[]
        setFacilityStylists(list)
        if (list.length > 0) setSelectedStylistId(list[0].id)
      })
      .catch(() => { /* picker stays empty — impersonation falls back to unlinked */ })
    return () => ctrl.abort()
  }, [selectedId])

  const handleImpersonate = async (role: DebugRole) => {
    if (!selected) return
    setLoading(role)
    try {
      const res = await fetch('/api/debug/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          facilityId: selected.id,
          facilityName: selected.name,
          // stylist impersonation carries the picked stylist identity
          stylistId: role === 'stylist' && selectedStylistId ? selectedStylistId : null,
        }),
      })
      if (res.ok) {
        window.location.href = '/dashboard'
      }
    } finally {
      setLoading(null)
    }
  }

  const handleReset = async () => {
    await fetch('/api/debug/reset', { method: 'POST' })
    window.location.href = '/master-admin'
  }

  const [franchiseLoading, setFranchiseLoading] = useState<'setup' | 'teardown' | null>(null)
  const handleDemoFranchise = async (teardown: boolean) => {
    setFranchiseLoading(teardown ? 'teardown' : 'setup')
    try {
      const res = await fetch('/api/debug/setup-demo-franchise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teardown }),
      })
      if (res.ok) {
        window.location.href = teardown ? '/master-admin' : '/franchise'
      } else {
        setFranchiseLoading(null)
      }
    } catch {
      setFranchiseLoading(null)
    }
  }

  const [portalLoading, setPortalLoading] = useState(false)
  const handleOpenPortal = async () => {
    if (!selected) return
    setPortalLoading(true)
    try {
      const res = await fetch('/api/debug/portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId: selected.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j.data?.facilityCode) {
        window.open(`/family/${encodeURIComponent(j.data.facilityCode)}`, '_blank')
      }
    } finally {
      setPortalLoading(false)
    }
  }

  const rows: { role: DebugRole | 'portal'; label: string; desc: string }[] = [
    { role: 'admin', label: 'Facility Admin View', desc: 'Full admin of one facility — residents, billing, settings, reports' },
    { role: 'super_admin', label: 'Franchise Admin View', desc: 'Admin across all the franchise’s facilities + the Franchise dashboard' },
    { role: 'facility_staff', label: 'Facility Staff View', desc: 'Front desk — scheduling, residents, services, sign-up sheet; no billing/payroll' },
    { role: 'bookkeeper', label: 'Bookkeeper View', desc: 'Billing, payments, payroll; read-only residents/log' },
    { role: 'stylist', label: 'Stylist View', desc: 'Calendar + daily log only; no residents or billing' },
    { role: 'portal', label: 'Family Portal (demo)', desc: 'Log in as a fake POA with demo data — no magic link needed' },
  ]

  return (
    <div className="mt-4 space-y-6">
      {/* Status indicator — always visible */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">Current Mode</p>
        {currentDebug ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              <span className="text-sm font-semibold text-amber-800">
                {ROLE_LABEL[currentDebug.role] ?? currentDebug.role} · {currentDebug.facilityName}
              </span>
            </div>
            <button
              onClick={handleReset}
              className="ml-4 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-400 text-amber-950 hover:bg-amber-500 transition-colors"
            >
              Reset to Master Admin
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <span className="text-sm font-medium text-stone-700">Master Admin (normal)</span>
          </div>
        )}
      </div>

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
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-stone-900">{label}</p>
              <p className="text-xs text-stone-500 mt-0.5">{desc}</p>
              {role === 'stylist' && selectedId && (
                facilityStylists.length > 0 ? (
                  <label className="mt-2 flex items-center gap-2 text-xs text-stone-600">
                    <span className="shrink-0">Preview as</span>
                    <select
                      value={selectedStylistId}
                      onChange={(e) => setSelectedStylistId(e.target.value)}
                      className="flex-1 max-w-xs px-2 py-1.5 rounded-lg border border-stone-200 text-xs text-stone-900 bg-white focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
                    >
                      {facilityStylists.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="mt-2 text-xs text-amber-600">
                    No stylists at this facility yet — you&apos;ll preview as an unlinked stylist (read-only banner).
                  </p>
                )
              )}
            </div>
            <button
              onClick={() => {
                if (role === 'portal') handleOpenPortal()
                else handleImpersonate(role)
              }}
              disabled={!selectedId || (role !== 'portal' && loading !== null) || (role === 'portal' && (!selected?.facilityCode || portalLoading))}
              className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#8B2E4A' }}
              onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#72253C' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#8B2E4A' }}
            >
              {role === 'portal' ? (portalLoading ? 'Opening…' : 'Open →') : loading === role ? 'Loading…' : 'Enter'}
            </button>
          </div>
        ))}
      </div>

      {/* Franchise demo — one-click sample franchise to preview the dashboard */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
        <p className="text-sm font-semibold text-stone-900">Franchise demo</p>
        <p className="text-xs text-stone-500 mt-0.5">
          Creates a throwaway sample franchise (Symphony Manor + Sunrise of Bethesda, demo data) and drops you into the Franchise Admin dashboard. Hidden from your real facility lists.
        </p>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => handleDemoFranchise(false)}
            disabled={franchiseLoading !== null}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#8B2E4A' }}
            onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#72253C' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#8B2E4A' }}
          >
            {franchiseLoading === 'setup' ? 'Setting up…' : 'Set up & preview demo franchise'}
          </button>
          <button
            onClick={() => handleDemoFranchise(true)}
            disabled={franchiseLoading !== null}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {franchiseLoading === 'teardown' ? 'Removing…' : 'Remove demo franchise'}
          </button>
        </div>
      </div>
    </div>
  )
}
