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

  // APLEY — the end-to-end demo: build the world, impersonate the Apley stylist,
  // then start the guided walk on the family signup page. The tour engine keeps
  // its place in sessionStorage, so the hard navigation into the portal (a
  // different layout AND a different identity) does not lose it.
  const [apleyLoading, setApleyLoading] = useState<'start' | 'reset' | null>(null)
  const [apleyError, setApleyError] = useState<string | null>(null)
  const [apleyNote, setApleyNote] = useState<string | null>(null)
  const runApley = async (action: 'start' | 'reset') => {
    setApleyLoading(action)
    setApleyError(null)
    setApleyNote(null)
    try {
      const res = await fetch('/api/debug/apley', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setApleyError(typeof j.error === 'string' ? j.error : 'Could not run the Apley demo')
        return
      }
      if (action === 'reset') {
        setApleyNote(j.data?.found ? 'Apley removed. Press Start to build it again.' : 'Nothing to remove — Apley was not set up.')
        // The impersonation cookie was cleared server-side; reload so the app
        // stops rendering as a stylist at a facility that no longer exists.
        window.location.href = '/master-admin'
        return
      }
      const card = j.data?.card as { mode: string; note: string } | undefined
      if (card?.note) setApleyNote(card.note)
      const { startScriptedTour } = await import('@/lib/help/scripted-tour')
      await startScriptedTour('scripted-apley-end-to-end')
    } catch {
      setApleyError('Network error — nothing was changed')
    } finally {
      setApleyLoading(null)
    }
  }

  // P60 — the Fitzgerald rehearsal launcher (docs/fitzgerald-walkthrough.md).
  const [rehearsalLoading, setRehearsalLoading] = useState(false)
  const [rehearsalError, setRehearsalError] = useState<string | null>(null)
  const handleRehearsal = async () => {
    if (!selected) return
    setRehearsalLoading(true)
    setRehearsalError(null)
    try {
      const res = await fetch('/api/debug/rehearsal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityId: selected.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRehearsalError(typeof j.error === 'string' ? j.error : 'Could not prepare the rehearsal')
        return
      }
      const code = j.data?.facilityCode as string | undefined
      if (code) window.open(`/family/${encodeURIComponent(code)}/signup?preview=1`, '_blank')
    } catch {
      setRehearsalError('Network error — nothing was prepared')
    } finally {
      setRehearsalLoading(false)
    }
  }

  // P51 — ordered bigger → smaller scale (franchise → cross-facility → facility
  // → chair → family), per Josh 2026-08-07.
  const rows: { role: DebugRole | 'portal' | 'signup'; label: string; desc: string }[] = [
    { role: 'super_admin', label: 'Franchise Admin View', desc: 'Admin across all the franchise’s facilities + the Franchise dashboard' },
    { role: 'bookkeeper', label: 'Bookkeeper View', desc: 'Cross-facility billing, payments, payroll; read-only residents/log' },
    { role: 'admin', label: 'Facility Admin View', desc: 'Full admin of one facility — residents, billing, settings, reports' },
    { role: 'facility_staff', label: 'Facility Staff View', desc: 'Front desk — scheduling, residents, services, sign-up sheet; no billing/payroll' },
    { role: 'stylist', label: 'Stylist View', desc: 'Calendar + day log only; no residents or billing' },
    { role: 'portal', label: 'Salon Account (demo)', desc: 'Log in as a fake POA with demo data — no magic link needed' },
    { role: 'signup', label: 'Family Sign-Up Wizard (dry run)', desc: 'Run the FULL signup wizard — matching, confirm card, and the real confirmation screen — but nothing is created (no accounts, no residents, no emails)' },
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
                else if (role === 'signup') {
                  // P53 — ?preview=1: the signup page + POST verify the master
                  // session server-side and run the whole pipeline with every
                  // write skipped. Works whether self-signup is on or off.
                  if (selected?.facilityCode) {
                    window.open(`/family/${encodeURIComponent(selected.facilityCode)}/signup?preview=1`, '_blank')
                  }
                } else handleImpersonate(role)
              }}
              disabled={
                !selectedId ||
                (role !== 'portal' && role !== 'signup' && loading !== null) ||
                ((role === 'portal' || role === 'signup') && !selected?.facilityCode) ||
                (role === 'portal' && portalLoading)
              }
              className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#8B2E4A' }}
              onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#72253C' }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#8B2E4A' }}
            >
              {role === 'portal' ? (portalLoading ? 'Opening…' : 'Open →') : role === 'signup' ? 'Open →' : loading === role ? 'Loading…' : 'Enter'}
            </button>
          </div>
        ))}
      </div>

      {/* APLEY — the whole journey, end to end, in its own demo facility. */}
      <div className="bg-white rounded-2xl border-2 border-[#8B2E4A]/20 p-4 shadow-sm">
        <p className="text-sm font-semibold text-stone-900">Apley — the whole journey</p>
        <p className="text-xs text-stone-500 mt-0.5">
          Builds <span className="font-mono">Apley Court</span>, its own demo facility, then walks the entire flow: a
          family signs up from the QR poster, saves a card, and asks for a visit; the stylist accepts it, does it, and
          finalizes the day; the card is charged and the family sees what it cost. Every record is real — created by the
          same code a live community uses — and demo-flagged so Reset removes all of it. With Stripe test keys the charge
          really happens; nothing here is simulated.
        </p>
        {apleyError && <p className="text-xs text-red-600 mt-2">{apleyError}</p>}
        {apleyNote && <p className="text-xs text-stone-600 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 mt-2">{apleyNote}</p>}
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => runApley('start')}
            disabled={apleyLoading !== null}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#8B2E4A' }}
            onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#72253C' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#8B2E4A' }}
          >
            {apleyLoading === 'start' ? 'Building…' : 'Start the Apley demo'}
          </button>
          <button
            onClick={() => runApley('reset')}
            disabled={apleyLoading !== null}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-stone-600 border border-stone-200 hover:bg-stone-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {apleyLoading === 'reset' ? 'Removing…' : 'Reset'}
          </button>
        </div>
      </div>

      {/* P60 — Fitzgerald rehearsal: seed the practice pieces the walkthrough
          needs at the SELECTED facility, then open the family sign-up dry run
          (scenario 2 in docs/fitzgerald-walkthrough.md). */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
        <p className="text-sm font-semibold text-stone-900">Launch rehearsal</p>
        <p className="text-xs text-stone-500 mt-0.5">
          Prepares the selected facility for a full walkthrough — a demo resident, a demo stylist with Mon–Fri hours, a
          practice price list and today&rsquo;s booking — then opens the family sign-up dry run. Only practice records are
          created; real residents, stylists and bookings are untouched. Follow{' '}
          <span className="font-mono">docs/fitzgerald-walkthrough.md</span> from scenario 2.
        </p>
        {rehearsalError && <p className="text-xs text-red-600 mt-2">{rehearsalError}</p>}
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleRehearsal}
            disabled={!selectedId || rehearsalLoading}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: '#8B2E4A' }}
            onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = '#72253C' }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#8B2E4A' }}
          >
            {rehearsalLoading ? 'Preparing…' : 'Prepare & start walkthrough'}
          </button>
        </div>
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
