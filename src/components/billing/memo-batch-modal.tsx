'use client'

// Batch memo scan modal — previews AI-matched per-resident attributions for
// all unmatched memo payments in a facility. Operator checks which payments
// to apply; each is applied individually to the existing POST endpoint.

import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { formatDollars } from '@/app/(protected)/billing/views/billing-shared'

interface BatchLine {
  rawName: string
  amountCents: number | null
  residentId: string | null
  residentName: string | null
  roomNumber: string | null
  confidence: 'high' | 'medium' | 'low' | null
  bookingId: string | null
  bookingDate: string | null
  serviceLabel: string | null
  bookingTotalCents: number | null
}

interface BatchPayment {
  paymentId: string
  checkNum: string | null
  paymentDate: string
  amountCents: number
  memo: string
  serviceDate: string | null
  lines: BatchLine[]
  matchedCount: number
  totalLines: number
}

const CONFIDENCE_CHIP: Record<string, string> = {
  high: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  medium: 'bg-amber-50 text-amber-700 border-amber-100',
  low: 'bg-stone-50 text-stone-500 border-stone-200',
}

function shortDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function MemoBatchModal({
  facilityId,
  onClose,
  onApplied,
}: {
  facilityId: string
  onClose: () => void
  onApplied: () => void
}) {
  const { toast } = useToast()
  const [state, setState] = useState<'loading' | 'empty' | 'error' | BatchPayment[]>('loading')
  // Set of paymentIds the operator wants to apply
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    cancelRef.current = false
    setState('loading')
    fetch('/api/billing/memo-match-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilityId }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((body) => {
        if (cancelRef.current) return
        const payments = body.data.payments as BatchPayment[]
        if (payments.length === 0) {
          setState('empty')
        } else {
          setState(payments)
          // Pre-check payments where all matched lines have both resident + amount
          setChecked(
            new Set(
              payments
                .filter(
                  (p) =>
                    p.matchedCount > 0 &&
                    p.lines.every(
                      (l) => !l.residentId || (l.residentId && l.amountCents != null)
                    )
                )
                .map((p) => p.paymentId)
            )
          )
        }
      })
      .catch(() => {
        if (!cancelRef.current) setState('error')
      })
    return () => {
      cancelRef.current = true
    }
  }, [facilityId])

  async function applyAll() {
    if (!Array.isArray(state) || applying) return
    const toApply = state.filter((p) => checked.has(p.paymentId))
    if (toApply.length === 0) return

    setApplying(true)
    setProgress({ done: 0, total: toApply.length })
    let appliedCount = 0
    let errorCount = 0

    for (let i = 0; i < toApply.length; i++) {
      if (cancelRef.current) break
      const p = toApply[i]
      const lines = p.lines
        .filter((l) => l.residentId && l.amountCents != null)
        .map((l) => ({
          rawName: l.rawName,
          residentId: l.residentId!,
          amountCents: l.amountCents!,
          bookingId: l.bookingId,
        }))
      if (lines.length === 0) {
        setProgress({ done: i + 1, total: toApply.length })
        continue
      }
      try {
        const res = await fetch(`/api/billing/memo-match/${p.paymentId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines }),
        })
        if (res.ok) {
          appliedCount++
        } else {
          errorCount++
        }
      } catch {
        errorCount++
      }
      setProgress({ done: i + 1, total: toApply.length })
    }

    setApplying(false)
    setProgress(null)

    if (appliedCount > 0) {
      toast.success(
        `${appliedCount} payment${appliedCount === 1 ? '' : 's'} attributed to residents${errorCount > 0 ? ` (${errorCount} failed — try individually)` : ''}`
      )
      onApplied()
      onClose()
    } else if (errorCount > 0) {
      toast.error('All applies failed — payments may have already been matched. Refresh and retry.')
    }
  }

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function toggleCheck(id: string) {
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const checkedCount = checked.size

  return (
    <Modal open onClose={onClose} title="Scan all memos" className="max-w-2xl">
      <div className="p-5">
        {state === 'loading' ? (
          <div className="space-y-2">
            <div className="skeleton rounded-xl h-14" />
            <div className="skeleton rounded-xl h-14" />
            <div className="skeleton rounded-xl h-14" />
            <p className="text-xs text-stone-400 text-center pt-2">
              AI is reading all memos — this may take a moment…
            </p>
          </div>
        ) : state === 'error' ? (
          <p className="text-sm text-red-600">Could not scan memos — please try again.</p>
        ) : state === 'empty' ? (
          <p className="text-sm text-stone-500">
            No unmatched memo payments found for this facility.
          </p>
        ) : (
          <>
            <p className="text-xs text-stone-500 mb-3">
              Found <span className="font-semibold text-stone-700">{state.length}</span> payment
              {state.length === 1 ? '' : 's'} with matchable memos. Check the ones you want to
              apply, then click Apply.
            </p>

            <div className="rounded-xl border border-stone-100 overflow-hidden divide-y divide-stone-50">
              {state.map((p) => {
                const isChecked = checked.has(p.paymentId)
                const isExpanded = expanded.has(p.paymentId)
                return (
                  <div key={p.paymentId}>
                    {/* Payment row */}
                    <div
                      className={`flex items-center gap-3 px-4 py-3 transition-colors duration-[120ms] ${
                        isChecked ? 'bg-[#F9EFF2]' : 'hover:bg-stone-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="shrink-0 accent-[#8B2E4A]"
                        checked={isChecked}
                        onChange={() => toggleCheck(p.paymentId)}
                      />
                      <button
                        type="button"
                        onClick={() => toggleExpand(p.paymentId)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-stone-900">
                            {p.checkNum ? `Check #${p.checkNum}` : 'Check'}
                          </span>
                          <span className="text-[11px] text-stone-400">{shortDate(p.paymentDate)}</span>
                          <span className="text-[13px] font-semibold text-stone-700">
                            {formatDollars(p.amountCents)}
                          </span>
                          <span className="text-[11px] text-stone-500 ml-1">
                            {p.matchedCount} of {p.totalLines} name{p.totalLines === 1 ? '' : 's'} matched
                          </span>
                          <span className="text-stone-300 ml-auto">
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        </div>
                        <p className="text-[11px] text-stone-400 italic mt-0.5 truncate">
                          &ldquo;{p.memo}&rdquo;
                        </p>
                      </button>
                    </div>

                    {/* Expanded line details */}
                    {isExpanded && (
                      <div className="bg-stone-50 border-t border-stone-100 px-4 py-2 space-y-2">
                        {p.lines.map((l, li) => (
                          <div key={li} className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[12px] font-semibold text-stone-800">
                                  {l.rawName}
                                </span>
                                {l.residentName ? (
                                  <>
                                    <span className="text-stone-300">→</span>
                                    <span className="text-[12px] text-stone-700">
                                      {l.residentName}
                                      {l.roomNumber && (
                                        <span className="text-stone-400 text-[10px] ml-1">
                                          Rm {l.roomNumber}
                                        </span>
                                      )}
                                    </span>
                                    {l.confidence && l.confidence !== 'high' && (
                                      <span
                                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${CONFIDENCE_CHIP[l.confidence]}`}
                                      >
                                        {l.confidence}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-[10px] text-stone-400">No match</span>
                                )}
                              </div>
                              {l.bookingDate && l.serviceLabel && (
                                <p className="text-[10.5px] text-stone-500 mt-0.5">
                                  {shortDate(l.bookingDate)} · {l.serviceLabel}
                                  {l.bookingTotalCents != null &&
                                    l.amountCents != null &&
                                    l.bookingTotalCents !== l.amountCents && (
                                      <span className="text-amber-600 font-semibold ml-1.5">
                                        price differs
                                      </span>
                                    )}
                                </p>
                              )}
                            </div>
                            <span className="text-[12px] font-semibold text-stone-900 shrink-0">
                              {l.amountCents != null ? formatDollars(l.amountCents) : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Progress bar during apply */}
            {progress && (
              <div className="mt-3">
                <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                  <div
                    className="h-full bg-[#8B2E4A] transition-[width] duration-300"
                    style={{ width: `${(progress.done / progress.total) * 100}%` }}
                  />
                </div>
                <p className="text-[11px] text-stone-500 mt-1 text-center">
                  Applying {progress.done} of {progress.total}…
                </p>
              </div>
            )}

            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-stone-500">
                {checkedCount === 0
                  ? 'No payments selected'
                  : `${checkedCount} payment${checkedCount === 1 ? '' : 's'} selected`}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={applying}
                  className="rounded-xl px-3.5 py-2 text-xs font-semibold bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void applyAll()}
                  disabled={checkedCount === 0 || applying}
                  className="rounded-xl px-3.5 py-2 text-xs font-bold bg-[#8B2E4A] text-white hover:bg-[#72253C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {applying
                    ? 'Applying…'
                    : `Apply ${checkedCount} payment${checkedCount === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
