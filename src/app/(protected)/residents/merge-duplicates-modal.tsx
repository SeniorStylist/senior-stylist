'use client'

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { fuzzyScore } from '@/lib/fuzzy'

type ResidentForMerge = {
  id: string
  name: string
  roomNumber: string | null
  appointmentCount: number
  lastVisit: string | null
  // P36 — merge-awareness indicators (may be absent from older cached payloads)
  hasPoa?: boolean
  autopayOn?: boolean
  hasStripeCustomer?: boolean
  hasPortalAccount?: boolean
  hasSavedCards?: boolean
}

type DupePair = {
  a: ResidentForMerge
  b: ResidentForMerge
  score: number
  sameRoom: boolean
}

interface MergeDuplicatesModalProps {
  open: boolean
  onClose: () => void
  onMerged: () => void
  facilityId: string
  onCountChange?: (count: number) => void
}

function pairKey(a: ResidentForMerge, b: ResidentForMerge): string {
  return [a.id, b.id].sort().join('-')
}

function formatVisit(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function MergeDuplicatesModal({
  open,
  onClose,
  onMerged,
  facilityId,
  onCountChange,
}: MergeDuplicatesModalProps) {
  const { toast } = useToast()
  const [pairs, setPairs] = useState<DupePair[]>([])
  const [loading, setLoading] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [keepSide, setKeepSide] = useState<Record<string, 'a' | 'b'>>({})
  const [editName, setEditName] = useState<Record<string, string>>({})
  const [editRoom, setEditRoom] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState<Record<string, boolean>>({})

  const storageKey = `dismissed-duplicate-pairs-${facilityId}`

  // Load dismissed from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]))
    } catch {
      // ignore
    }
  }, [storageKey])

  const fetchPairs = useCallback(() => {
    setLoading(true)
    fetch('/api/residents/duplicates')
      .then(r => r.json())
      .then(json => {
        const fetched: DupePair[] = json.data?.pairs ?? []
        setPairs(fetched)
        onCountChange?.(fetched.length)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [onCountChange])

  // Fetch pairs when modal opens
  useEffect(() => {
    if (!open) return
    fetchPairs()
  }, [open, fetchPairs])

  const visiblePairs = pairs.filter(p => !dismissed.has(pairKey(p.a, p.b)))

  function dismissPair(key: string) {
    const next = new Set(dismissed)
    next.add(key)
    setDismissed(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]))
    } catch {
      // ignore
    }
    onCountChange?.(visiblePairs.length - 1)
  }

  function selectSide(key: string, side: 'a' | 'b', pair: DupePair) {
    const chosen = side === 'a' ? pair.a : pair.b
    setKeepSide(prev => ({ ...prev, [key]: side }))
    setEditName(prev => ({ ...prev, [key]: chosen.name }))
    setEditRoom(prev => ({ ...prev, [key]: chosen.roomNumber ?? '' }))
  }

  async function handleMerge(pair: DupePair) {
    const key = pairKey(pair.a, pair.b)
    const side = keepSide[key]
    if (!side) return
    const keepRes = side === 'a' ? pair.a : pair.b
    const mergeRes = side === 'a' ? pair.b : pair.a
    const finalName = editName[key]?.trim()
    if (!finalName) return

    setMerging(prev => ({ ...prev, [key]: true }))
    try {
      const res = await fetch('/api/residents/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keepId: keepRes.id,
          mergeId: mergeRes.id,
          finalName,
          finalRoom: editRoom[key]?.trim() || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        // P34 — a pair referencing a resident merged in another tab / by
        // another user comes back as a clean 409; drop it and resync.
        if (json.code === 'stale_pair') {
          setPairs(prev => prev.filter(p => pairKey(p.a, p.b) !== key))
          toast('That pair was already merged elsewhere — refreshing the list', 'info')
          fetchPairs()
          return
        }
        toast(typeof json.error === 'string' ? json.error : 'Merge failed', 'error')
        return
      }
      const { bookingsMoved } = json.data

      // P34 — re-chain the remaining pairs to the SURVIVOR in one in-memory
      // pass (no O(n²) refetch). With many variants of one name ("Carole
      // Rose" ⇄ "Carole Jaqueline Rose" ⇄ "Carol Rose"), other pending pairs
      // still referenced the resident that was just merged away — merging
      // them then failed. Every side that pointed at the merged-away id (or
      // at the survivor, to pick up its new name/room/visit totals) is
      // re-pointed to the survivor; self-pairs collapse; rewritten pairs that
      // now collide dedupe; match % is recomputed against the final name.
      const survivor: ResidentForMerge = {
        id: keepRes.id,
        name: finalName,
        roomNumber: editRoom[key]?.trim() || null,
        appointmentCount: keepRes.appointmentCount + mergeRes.appointmentCount,
        lastVisit:
          [keepRes.lastVisit, mergeRes.lastVisit]
            .filter((v): v is string => !!v)
            .sort()
            .pop() ?? null,
        // P36 — the survivor inherits POA/portal links; cards move only when
        // the survivor had no Stripe customer (mirrors the server rule).
        hasPoa: keepRes.hasPoa || mergeRes.hasPoa,
        hasPortalAccount: keepRes.hasPortalAccount || mergeRes.hasPortalAccount,
        hasStripeCustomer: keepRes.hasStripeCustomer || mergeRes.hasStripeCustomer,
        hasSavedCards: keepRes.hasSavedCards || (mergeRes.hasSavedCards && !keepRes.hasStripeCustomer),
        autopayOn: keepRes.autopayOn || (mergeRes.autopayOn && !keepRes.hasStripeCustomer),
      }
      const touchedIds = new Set([keepRes.id, mergeRes.id])
      const seen = new Set<string>()
      const next: DupePair[] = []
      for (const p of pairs) {
        const k = pairKey(p.a, p.b)
        if (k === key) continue // the pair we just merged
        const a = touchedIds.has(p.a.id) ? survivor : p.a
        const b = touchedIds.has(p.b.id) ? survivor : p.b
        if (a.id === b.id) continue // collapsed into the survivor itself
        const nk = pairKey(a, b)
        if (seen.has(nk)) continue // two old pairs rewrote to the same pair
        seen.add(nk)
        if (a === p.a && b === p.b) {
          next.push(p)
        } else {
          next.push({ ...p, a, b, score: fuzzyScore(a.name, b.name) })
        }
      }
      setPairs(next)
      onCountChange?.(next.filter(p => !dismissed.has(pairKey(p.a, p.b))).length)
      toast(
        `Merged — ${bookingsMoved} booking${bookingsMoved !== 1 ? 's' : ''} moved`,
        'success'
      )
      onMerged()
    } catch {
      toast('Network error', 'error')
    } finally {
      setMerging(prev => ({ ...prev, [key]: false }))
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end md:items-center md:justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-t-3xl md:rounded-2xl w-full md:max-w-2xl md:mx-4 max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div
          className="flex items-center justify-between px-5 pb-4 border-b border-stone-100 shrink-0"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 20px)' }}
        >
          <div>
            <h2 className="text-base font-semibold text-stone-900">Find Duplicates</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              {loading
                ? 'Scanning for duplicates…'
                : `${visiblePairs.length} potential duplicate${visiblePairs.length !== 1 ? 's' : ''} found`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-stone-100 text-stone-400 hover:text-stone-600 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>

          {loading ? (
            <div className="py-16 flex flex-col items-center gap-3">
              <div className="w-6 h-6 rounded-full border-2 border-stone-200 border-t-[#8B2E4A] animate-spin" />
              <p className="text-sm text-stone-400">Scanning residents…</p>
            </div>
          ) : visiblePairs.length === 0 ? (
            <div className="py-16 flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8B2E4A" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-stone-700">No duplicates found</p>
              <p className="text-xs text-stone-400 max-w-xs">
                All residents look unique. Dismissed pairs won&apos;t reappear.
              </p>
            </div>
          ) : (
            visiblePairs.map((pair) => {
              const key = pairKey(pair.a, pair.b)
              const side = keepSide[key]
              const isMerging = merging[key] ?? false

              return (
                <div key={key} data-tour="duplicates-pair-card" className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3 shadow-sm">

                  {/* Badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      'text-xs font-semibold px-2 py-0.5 rounded-full',
                      pair.score >= 0.8 ? 'bg-rose-100 text-[#8B2E4A]' : 'bg-amber-100 text-amber-700'
                    )}>
                      {Math.round(pair.score * 100)}% match
                    </span>
                    {pair.sameRoom && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-[#8B2E4A]">
                        Same room
                      </span>
                    )}
                  </div>

                  {/* Side-by-side */}
                  <div className="grid grid-cols-2 gap-3">
                    {(['a', 'b'] as const).map((s) => {
                      const r = pair[s]
                      const selected = side === s
                      return (
                        <div
                          key={s}
                          className={cn(
                            'rounded-xl border p-3 transition-colors',
                            selected
                              ? 'border-[#8B2E4A] bg-rose-50/50'
                              : 'border-stone-200 bg-stone-50'
                          )}
                        >
                          <p className="text-xs font-semibold text-stone-500 mb-1.5 uppercase tracking-wide">
                            {s === 'a' ? 'A' : 'B'}
                          </p>
                          <p className="text-sm font-semibold text-stone-900 leading-tight">{r.name}</p>
                          {r.roomNumber && (
                            <p className="text-xs text-stone-500 mt-0.5">Room {r.roomNumber}</p>
                          )}
                          <p className="text-xs text-stone-400 mt-1.5">
                            {r.appointmentCount} visit{r.appointmentCount !== 1 ? 's' : ''}
                          </p>
                          <p className="text-xs text-stone-400">
                            Last: {formatVisit(r.lastVisit)}
                          </p>
                          {/* P36 — POA / portal / cards / autopay indicators */}
                          {(r.hasPoa || r.hasPortalAccount || r.hasSavedCards || r.autopayOn) && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {r.hasPoa && (
                                <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">POA</span>
                              )}
                              {r.hasPortalAccount && (
                                <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Portal</span>
                              )}
                              {r.hasSavedCards && (
                                <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">Card</span>
                              )}
                              {r.autopayOn && (
                                <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Autopay</span>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {/* P36 — data-consequence warnings for the chosen direction */}
                  {side && (() => {
                    const loser = side === 'a' ? pair.b : pair.a
                    const winner = side === 'a' ? pair.a : pair.b
                    const notes: string[] = []
                    if (loser.hasPortalAccount) {
                      notes.push(`${loser.name}'s family portal account will move to the kept resident.`)
                    }
                    if (loser.hasPoa && !winner.hasPoa) {
                      notes.push(`POA contact info will be inherited from ${loser.name}.`)
                    }
                    if (loser.hasSavedCards && winner.hasStripeCustomer) {
                      notes.push(`${loser.name}'s saved card can't move automatically — re-add it on the kept resident after merging.`)
                    } else if (loser.hasSavedCards) {
                      notes.push(`${loser.name}'s saved card and autopay settings will move to the kept resident.`)
                    }
                    if (notes.length === 0) return null
                    return (
                      <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 space-y-0.5">
                        {notes.map((n, i) => <p key={i}>{n}</p>)}
                      </div>
                    )
                  })()}

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-wrap">
                    {(['a', 'b'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => selectSide(key, s, pair)}
                        data-tour={s === 'a' ? 'duplicates-keep-btn' : undefined}
                        className={cn(
                          'flex-1 min-h-[36px] text-xs font-semibold rounded-xl border transition-colors',
                          side === s
                            ? 'bg-[#8B2E4A] text-white border-[#8B2E4A]'
                            : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                        )}
                      >
                        Keep {s.toUpperCase()}
                      </button>
                    ))}
                    <button
                      onClick={() => dismissPair(key)}
                      className="min-h-[36px] px-3 text-xs font-medium text-stone-400 hover:text-stone-600 transition-colors"
                    >
                      Not a duplicate
                    </button>
                  </div>

                  {/* Merge form */}
                  {side && (
                    <div className="pt-3 border-t border-stone-100 space-y-2">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-xs font-medium text-stone-500 block mb-1">Name</label>
                          <input
                            value={editName[key] ?? ''}
                            onChange={(e) => setEditName(prev => ({ ...prev, [key]: e.target.value }))}
                            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                          />
                        </div>
                        <div className="w-24">
                          <label className="text-xs font-medium text-stone-500 block mb-1">Room</label>
                          <input
                            value={editRoom[key] ?? ''}
                            onChange={(e) => setEditRoom(prev => ({ ...prev, [key]: e.target.value }))}
                            placeholder="—"
                            className="w-full bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 transition-all"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => handleMerge(pair)}
                        disabled={isMerging || !editName[key]?.trim()}
                        data-tour="duplicates-merge-btn"
                        className="w-full min-h-[40px] bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl hover:bg-[#72253C] transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                      >
                        {isMerging ? (
                          <>
                            <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            Merging…
                          </>
                        ) : (
                          'Merge →'
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
