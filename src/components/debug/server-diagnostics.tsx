'use client'

// P61 — "What the server sees".
//
// The owner reported the same invisible-facility symptom twice, and both times
// it was diagnosed by reading source, because nothing in the app could say what
// the server actually thought the session was. This card says it: who you are
// recognised as, which facility you resolve to, what your switcher should
// contain, whether the franchise filter is involved — and, on demand, why a
// specific facility or stylist is or isn't visible.
//
// Loads only when opened: this is a diagnostic, not something to pay for on
// every Debug tab render.

import { useState } from 'react'

interface Diagnostics {
  email: string | null
  ownerEnvVarConfigured: boolean
  recognisedAsOwner: boolean
  selectedFacilityId: string | null
  debugCookie: unknown
  resolvedFacility: { facilityId: string; role: string; rawRole: string } | null
  memberships: { facilityId: string; role: string; name: string | null; facilityCode: string | null; active: boolean | null; isDemo: boolean | null }[]
  activeFacilityCount: number
  expectedSwitcherCount: number
  franchiseFilter: { applies: boolean; note: string; franchiseName?: string }
  facilityLookup: { found: boolean; why: string; name?: string; facilityCode?: string | null; active?: boolean; isDemo?: boolean } | null
  stylistLookup: { found: boolean; why: string; name?: string; stylistCode?: string | null; visibleOnRosters?: boolean } | null
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-stone-100 last:border-0">
      <span className="text-xs text-stone-500 w-44 shrink-0">{label}</span>
      <span
        className={`text-xs font-mono break-all ${
          tone === 'bad' ? 'text-red-700 font-semibold' : tone === 'good' ? 'text-emerald-700' : 'text-stone-800'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

export function ServerDiagnostics() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Diagnostics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facilityQ, setFacilityQ] = useState('')
  const [stylistQ, setStylistQ] = useState('')

  const load = async (fq = '', sq = '') => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (fq.trim()) params.set('facility', fq.trim())
      if (sq.trim()) params.set('stylist', sq.trim())
      const res = await fetch(`/api/debug/whoami${params.toString() ? `?${params}` : ''}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof j?.error === 'string' ? j.error : 'Could not read the diagnostics')
        return
      }
      setData(j.data)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
        <p className="text-sm font-semibold text-stone-900">What the server sees</p>
        <p className="text-xs text-stone-500 mt-1 leading-relaxed">
          Who you&apos;re recognised as, which facility you resolve to, and why a facility or
          stylist is or isn&apos;t visible. Open this first when something seems to be missing.
        </p>
        <button
          onClick={() => {
            setOpen(true)
            void load()
          }}
          className="mt-3 px-3 py-1.5 rounded-xl text-xs font-semibold bg-stone-900 text-white hover:bg-stone-700 transition-colors"
        >
          Run diagnostics
        </button>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-stone-900">What the server sees</p>
        <button onClick={() => setOpen(false)} className="text-xs text-stone-400 hover:text-stone-600">
          Hide
        </button>
      </div>

      {loading && <p className="text-xs text-stone-500 mt-3">Reading…</p>}
      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}

      {data && (
        <div className="mt-3">
          <Row label="Signed in as" value={data.email ?? '—'} />
          <Row
            label="Recognised as owner"
            value={data.recognisedAsOwner ? 'yes' : 'NO — email does not match the owner env var'}
            tone={data.recognisedAsOwner ? 'good' : 'bad'}
          />
          {!data.ownerEnvVarConfigured && (
            <Row label="Owner env var" value="NOT SET on the server" tone="bad" />
          )}
          <Row
            label="Impersonating"
            value={data.debugCookie ? JSON.stringify(data.debugCookie) : 'no'}
            tone={data.debugCookie ? 'bad' : 'good'}
          />
          <Row label="Selected facility (cookie)" value={data.selectedFacilityId ?? 'none'} />
          <Row
            label="Resolves to"
            value={
              data.resolvedFacility
                ? `${data.resolvedFacility.facilityId} · role ${data.resolvedFacility.role} (raw ${data.resolvedFacility.rawRole})`
                : 'nothing — getUserFacility returned null'
            }
            tone={data.resolvedFacility ? undefined : 'bad'}
          />
          <Row label="Active facilities in DB" value={String(data.activeFacilityCount)} />
          <Row label="Switcher should list" value={String(data.expectedSwitcherCount)} />
          <Row
            label="Franchise filter"
            value={data.franchiseFilter.note}
            tone={data.franchiseFilter.applies ? 'bad' : undefined}
          />
          <Row label="Membership rows" value={String(data.memberships.length)} />
          {data.memberships.length > 0 && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-stone-50 p-2">
              {data.memberships.map((m) => (
                <p key={m.facilityId} className="text-[11px] font-mono text-stone-600 leading-relaxed">
                  {m.facilityCode ?? '—'} {m.name ?? m.facilityId} · {m.role}
                  {m.active === false ? ' · INACTIVE' : ''}
                  {m.isDemo ? ' · demo' : ''}
                </p>
              ))}
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-stone-100">
            <p className="text-xs font-semibold text-stone-700 mb-2">Why can&apos;t I see…</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={facilityQ}
                onChange={(e) => setFacilityQ(e.target.value)}
                placeholder="Facility code or name (F240)"
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-stone-200 text-xs focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
              <input
                value={stylistQ}
                onChange={(e) => setStylistQ(e.target.value)}
                placeholder="Stylist code or name (ST833)"
                className="flex-1 px-2.5 py-1.5 rounded-lg border border-stone-200 text-xs focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
              <button
                onClick={() => void load(facilityQ, stylistQ)}
                disabled={loading || (!facilityQ.trim() && !stylistQ.trim())}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-stone-900 text-white disabled:opacity-40"
              >
                Check
              </button>
            </div>

            {data.facilityLookup && (
              <div className="mt-2 rounded-lg bg-stone-50 p-2.5">
                <p className="text-[11px] font-semibold text-stone-700">
                  {data.facilityLookup.found
                    ? `${data.facilityLookup.facilityCode ?? ''} ${data.facilityLookup.name ?? ''}`.trim()
                    : 'Facility not found'}
                </p>
                <p className="text-[11px] text-stone-600 mt-0.5 leading-relaxed">{data.facilityLookup.why}</p>
              </div>
            )}
            {data.stylistLookup && (
              <div className="mt-2 rounded-lg bg-stone-50 p-2.5">
                <p className="text-[11px] font-semibold text-stone-700">
                  {data.stylistLookup.found
                    ? `${data.stylistLookup.stylistCode ?? ''} ${data.stylistLookup.name ?? ''}`.trim()
                    : 'Stylist not found'}
                </p>
                <p
                  className={`text-[11px] mt-0.5 leading-relaxed ${
                    data.stylistLookup.found && !data.stylistLookup.visibleOnRosters
                      ? 'text-red-700 font-semibold'
                      : 'text-stone-600'
                  }`}
                >
                  {data.stylistLookup.why}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
