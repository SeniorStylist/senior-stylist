'use client'

import { useState, useEffect } from 'react'

interface FacilityRow {
  id: string
  name: string
  facilityCode: string | null
  address: string | null
  phone: string | null
  contactEmail: string | null
  paymentType: string
  residents: number
  bookings: number
  stylists: number
}

interface Candidate {
  secondary: FacilityRow
  primary: FacilityRow
  score: number
  confidence: 'high' | 'medium' | 'low'
}

interface MergeResult {
  secondaryFacilityName: string
  residentsTransferred: number
  residentsConflicted: number
  bookingsTransferred: number
  logEntriesTransferred: number
  logEntriesDropped: number
  stylistAssignmentsTransferred: number
  stylistAssignmentsDropped: number
  qbInvoicesTransferred: number
  qbInvoicesDropped: number
  qbPaymentsTransferred: number
  fieldsInherited: string[]
}

export function MergeTab() {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [unpaired, setUnpaired] = useState<FacilityRow[]>([])
  const [fidCount, setFidCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [confirmPair, setConfirmPair] = useState<{ primary: FacilityRow; secondary: FacilityRow } | null>(null)
  const [typedName, setTypedName] = useState('')
  const [merging, setMerging] = useState(false)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    void fetchCandidates()
  }, [])

  async function fetchCandidates() {
    setLoading(true)
    try {
      const res = await fetch('/api/super-admin/merge-candidates')
      const json = await res.json()
      if (res.ok) {
        setCandidates(json.data.candidates)
        setUnpaired(json.data.unpaired)
        setFidCount(json.data.fidFacilityCount)
      } else {
        setToast({ kind: 'error', text: json.error ?? 'Failed to load candidates' })
        setTimeout(() => setToast(null), 5000)
      }
    } catch (err) {
      setToast({ kind: 'error', text: (err as Error).message })
      setTimeout(() => setToast(null), 5000)
    } finally {
      setLoading(false)
    }
  }

  function swapSides(id: string) {
    setCandidates((prev) =>
      prev.map((c) =>
        c.secondary.id === id ? { ...c, primary: c.secondary, secondary: c.primary } : c,
      ),
    )
  }

  async function handleMerge() {
    if (!confirmPair) return
    setMerging(true)
    try {
      const res = await fetch('/api/super-admin/merge-facilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primaryFacilityId: confirmPair.primary.id,
          secondaryFacilityId: confirmPair.secondary.id,
        }),
      })
      const json = (await res.json()) as { data?: MergeResult; error?: string }
      if (res.ok && json.data) {
        const d = json.data
        setToast({
          kind: 'success',
          text: `Merged — ${d.bookingsTransferred} bookings, ${d.residentsTransferred} residents (${d.residentsConflicted} deduped)${d.fieldsInherited.length ? `, inherited ${d.fieldsInherited.length} field${d.fieldsInherited.length !== 1 ? 's' : ''}` : ''}`,
        })
        setTimeout(() => setToast(null), 5000)
        setConfirmPair(null)
        setTypedName('')
        await fetchCandidates()
      } else {
        setToast({ kind: 'error', text: json.error ?? 'Merge failed' })
        setTimeout(() => setToast(null), 6000)
      }
    } catch (err) {
      setToast({ kind: 'error', text: (err as Error).message })
      setTimeout(() => setToast(null), 6000)
    } finally {
      setMerging(false)
    }
  }

  const typedOk =
    confirmPair != null && typedName.trim().toLowerCase() === confirmPair.secondary.name.toLowerCase()

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="bg-white rounded-2xl border border-stone-200 p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-stone-900">Facility Merge Tool</div>
          <div className="text-xs text-stone-500 mt-0.5">
            Consolidate no-FID duplicate facilities into their QB-imported canonical record.
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-stone-500">
          <div>
            <span className="font-semibold text-stone-900">{fidCount}</span> with F-code
          </div>
          <div>
            <span className="font-semibold text-stone-900">{candidates.length}</span> suggested pair
            {candidates.length !== 1 ? 's' : ''}
          </div>
          <div>
            <span className="font-semibold text-stone-900">{unpaired.length}</span> unmatched
          </div>
        </div>
      </div>

      {/* Suggested merges */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-stone-900">Suggested merges</h2>
          <span className="text-xs text-stone-500">
            {candidates.length} pair{candidates.length !== 1 ? 's' : ''}
          </span>
        </div>
        {loading ? (
          <div className="py-12 text-center text-sm text-stone-400">Loading…</div>
        ) : candidates.length === 0 ? (
          <div className="py-12 text-center text-sm text-stone-400 bg-white rounded-2xl border border-stone-200">
            No duplicate facilities detected.
          </div>
        ) : (
          <div className="space-y-3">
            {candidates.map((c) => (
              <div key={c.secondary.id} className="bg-white rounded-2xl border border-stone-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-stone-400">
                    Fuzzy score: {(c.score * 100).toFixed(0)}%
                  </span>
                  <ConfidenceBadge confidence={c.confidence} />
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-stretch">
                  <PairCard side="primary" facility={c.primary} />
                  <button
                    onClick={() => swapSides(c.secondary.id)}
                    className="self-center p-2 rounded-full hover:bg-stone-100 transition-colors text-stone-400 hover:text-stone-600"
                    title="Swap primary / secondary"
                  >
                    <span className="text-lg leading-none">⇄</span>
                  </button>
                  <PairCard side="secondary" facility={c.secondary} />
                </div>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-stone-500">
                    Primary keeps its own fields; inherits any missing field from secondary.
                  </span>
                  <button
                    onClick={() => setConfirmPair({ primary: c.primary, secondary: c.secondary })}
                    className="px-3 py-1.5 rounded-xl text-sm font-medium text-white transition-colors"
                    style={{ backgroundColor: '#8B2E4A' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#72253C')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#8B2E4A')}
                  >
                    Merge →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Unpaired */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-stone-900">No match found</h2>
          <span className="text-xs text-stone-500">
            {unpaired.length} facilit{unpaired.length !== 1 ? 'ies' : 'y'}
          </span>
        </div>
        <p className="text-xs text-stone-500 mb-3">
          These no-FID facilities don&apos;t fuzzy-match any FID facility. Assign an F-code manually from the
          Facilities tab, or ignore if intentional.
        </p>
        {unpaired.length === 0 ? (
          <div className="py-8 text-center text-sm text-stone-400 bg-white rounded-2xl border border-stone-200">
            All no-FID facilities are paired.
          </div>
        ) : (
          <div className="space-y-2">
            {unpaired.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between bg-white rounded-xl border border-stone-200 p-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-stone-900 truncate">{u.name}</div>
                  <div className="text-xs text-stone-500">
                    {u.residents} resident{u.residents !== 1 ? 's' : ''} · {u.bookings} booking
                    {u.bookings !== 1 ? 's' : ''} · {u.stylists} stylist{u.stylists !== 1 ? 's' : ''}
                  </div>
                </div>
                <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-3">
                  No FID
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Confirmation modal */}
      {confirmPair && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold text-stone-900 mb-2">Confirm merge</h3>
            <p className="text-sm text-stone-600 mb-4">
              <strong>{confirmPair.secondary.name}</strong> will be deactivated. All its residents,
              bookings, stylists, and assignments will move to{' '}
              <strong>{confirmPair.primary.name}</strong>. This cannot be undone automatically.
            </p>
            <label className="block text-xs font-medium text-stone-600 mb-1">
              Type the secondary facility name to confirm:
            </label>
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={confirmPair.secondary.name}
              autoFocus
              className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setConfirmPair(null)
                  setTypedName('')
                }}
                disabled={merging}
                className="px-3 py-1.5 rounded-xl text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleMerge}
                disabled={!typedOk || merging}
                className="px-3 py-1.5 rounded-xl text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: '#8B2E4A' }}
              >
                {merging ? 'Merging…' : 'Merge now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 text-sm font-medium px-5 py-2.5 rounded-2xl shadow-xl z-50 ${
            toast.kind === 'success' ? 'bg-stone-900 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const styles = {
    high: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    low: 'bg-stone-100 text-stone-600 border-stone-200',
  }
  const label = {
    high: 'High confidence',
    medium: 'Likely match',
    low: 'Review carefully',
  }[confidence]
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${styles[confidence]}`}>
      {label}
    </span>
  )
}

function PairCard({ side, facility }: { side: 'primary' | 'secondary'; facility: FacilityRow }) {
  const bg = side === 'primary' ? 'bg-stone-50 border-stone-200' : 'bg-amber-50 border-amber-200'
  const label = side === 'primary' ? 'Keep (primary)' : 'Merge away (secondary)'
  return (
    <div className={`rounded-xl border p-3 ${bg}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 mb-1.5">
        {label}
      </div>
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        {facility.facilityCode ? (
          <span className="inline-flex items-center rounded-md bg-stone-100 text-stone-500 text-xs font-mono px-1.5 py-0.5">
            {facility.facilityCode}
          </span>
        ) : (
          <span className="text-xs bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded-full font-medium">
            No FID
          </span>
        )}
        <span className="font-medium text-stone-900 text-sm truncate">{facility.name}</span>
      </div>
      <div className="text-xs text-stone-500">
        {facility.residents} residents · {facility.bookings} bookings · {facility.stylists} stylists
      </div>
      {facility.address && (
        <div className="text-xs text-stone-400 mt-1 truncate">{facility.address}</div>
      )}
      {facility.contactEmail && (
        <div className="text-xs text-stone-400 truncate">{facility.contactEmail}</div>
      )}
    </div>
  )
}
