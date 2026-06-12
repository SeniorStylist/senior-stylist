'use client'

// Preview/confirm modal for memo dissection — shows the parsed per-resident
// lines from a check memo with fuzzy resident matches and unpaid-booking
// candidates. Nothing is applied until the operator confirms; unmatched lines
// are un-checkable. Applying flips the bookings to paid (with a "Paid via
// check #N" note) and stores the breakdown on the payment.

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { formatDollars, BillingPayment } from '@/app/(protected)/billing/views/billing-shared'

interface PreviewLine {
  rawName: string
  amountCents: number | null
  residentId: string | null
  residentName: string | null
  roomNumber: string | null
  confidence: 'high' | 'medium' | 'low' | null
  booking: {
    id: string
    dateStr: string
    serviceLabel: string
    totalCents: number
  } | null
}

interface Preview {
  serviceDate: string | null
  checkNum: string | null
  checkAmountCents: number
  lines: PreviewLine[]
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

export function MemoMatchModal({
  payment,
  onClose,
  onApplied,
}: {
  payment: BillingPayment
  onClose: () => void
  onApplied: (updated: BillingPayment) => void
}) {
  const { toast } = useToast()
  const [preview, setPreview] = useState<Preview | 'loading' | 'error'>('loading')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/billing/memo-match/${payment.id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((body) => {
        if (cancelled) return
        const p = body.data as Preview
        setPreview(p)
        // pre-check only lines with both a resident and a booking match
        setChecked(
          new Set(
            p.lines
              .map((l, i) => (l.residentId && l.booking && l.amountCents != null ? i : -1))
              .filter((i) => i >= 0)
          )
        )
      })
      .catch(() => {
        if (!cancelled) setPreview('error')
      })
    return () => {
      cancelled = true
    }
  }, [payment.id])

  async function apply() {
    if (preview === 'loading' || preview === 'error' || applying) return
    const lines = [...checked]
      .map((i) => preview.lines[i])
      .filter((l) => l.residentId && l.amountCents != null)
      .map((l) => ({
        rawName: l.rawName,
        residentId: l.residentId!,
        amountCents: l.amountCents!,
        bookingId: l.booking?.id ?? null,
      }))
    if (lines.length === 0) return
    setApplying(true)
    try {
      const res = await fetch(`/api/billing/memo-match/${payment.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(typeof body?.error === 'string' ? body.error : 'Could not apply matches')
        return
      }
      toast.success(
        `${body.data.applied} service${body.data.applied === 1 ? '' : 's'} marked paid from this check`
      )
      onApplied({ ...payment, residentBreakdown: body.data.breakdown })
      onClose()
    } catch {
      toast.error('Network error — nothing was applied')
    } finally {
      setApplying(false)
    }
  }

  const selectable =
    preview !== 'loading' && preview !== 'error'
      ? preview.lines.filter((l) => l.residentId && l.amountCents != null).length
      : 0
  const checkedTotal =
    preview !== 'loading' && preview !== 'error'
      ? [...checked].reduce((s, i) => s + (preview.lines[i]?.amountCents ?? 0), 0)
      : 0

  return (
    <Modal open onClose={onClose} title="Match memo to residents" className="max-w-2xl">
      <div className="p-5">
        {preview === 'loading' ? (
          <div className="space-y-2">
            <div className="skeleton rounded-xl h-10" />
            <div className="skeleton rounded-xl h-10" />
            <div className="skeleton rounded-xl h-10" />
          </div>
        ) : preview === 'error' ? (
          <p className="text-sm text-red-600">Could not read this memo — try again.</p>
        ) : (
          <>
            <p className="text-xs text-stone-500 mb-1">
              Check {preview.checkNum ? `#${preview.checkNum}` : ''} ·{' '}
              <span className="font-semibold text-stone-700">{formatDollars(preview.checkAmountCents)}</span>
              {preview.serviceDate && <> · service date {shortDate(preview.serviceDate)}</>}
            </p>
            <p className="text-[11px] text-stone-400 italic mb-3 break-words">“{payment.memo}”</p>

            {preview.lines.length === 0 ? (
              <p className="text-sm text-stone-500">
                Couldn&apos;t find any name + amount pairs in this memo.
              </p>
            ) : (
              <div className="rounded-xl border border-stone-100 overflow-hidden">
                {preview.lines.map((l, i) => {
                  const selectableLine = !!l.residentId && l.amountCents != null
                  const isChecked = checked.has(i)
                  const priceDiffers =
                    l.booking && l.amountCents != null && l.booking.totalCents !== l.amountCents
                  return (
                    <label
                      key={i}
                      className={`flex items-start gap-3 px-4 py-3 border-t border-stone-50 first:border-t-0 transition-colors duration-[120ms] ${
                        selectableLine ? 'cursor-pointer hover:bg-[#F9EFF2]' : 'opacity-60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-[#8B2E4A]"
                        disabled={!selectableLine}
                        checked={isChecked}
                        onChange={() =>
                          setChecked((s) => {
                            const next = new Set(s)
                            if (next.has(i)) next.delete(i)
                            else next.add(i)
                            return next
                          })
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-semibold text-stone-900">{l.rawName}</span>
                          {l.residentName ? (
                            <>
                              <span className="text-stone-300">→</span>
                              <span className="text-[13px] text-stone-700">
                                {l.residentName}
                                {l.roomNumber && (
                                  <span className="text-stone-400 text-xs ml-1">Rm {l.roomNumber}</span>
                                )}
                              </span>
                              {l.confidence && l.confidence !== 'high' && (
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${CONFIDENCE_CHIP[l.confidence]}`}>
                                  {l.confidence} match
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-stone-400">No resident match</span>
                          )}
                        </div>
                        {l.booking ? (
                          <p className="text-[11.5px] text-stone-500 mt-0.5">
                            {shortDate(l.booking.dateStr)} · {l.booking.serviceLabel} ·{' '}
                            {formatDollars(l.booking.totalCents)}
                            {priceDiffers && (
                              <span className="text-amber-600 font-semibold ml-1.5">
                                price differs from memo amount
                              </span>
                            )}
                          </p>
                        ) : l.residentId ? (
                          <p className="text-[11.5px] text-stone-400 mt-0.5">
                            No unpaid service found near this date — amount will be recorded on the
                            check only.
                          </p>
                        ) : null}
                      </div>
                      <span className="text-sm font-semibold text-stone-900 shrink-0">
                        {l.amountCents != null ? formatDollars(l.amountCents) : '—'}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}

            <div className="flex items-center justify-between mt-4">
              <p className="text-xs text-stone-500">
                Selected:{' '}
                <span className={`font-semibold ${checkedTotal === preview.checkAmountCents ? 'text-emerald-700' : 'text-stone-700'}`}>
                  {formatDollars(checkedTotal)}
                </span>{' '}
                of {formatDollars(preview.checkAmountCents)}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl px-3.5 py-2 text-xs font-semibold bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={checked.size === 0 || selectable === 0 || applying}
                  className="rounded-xl px-3.5 py-2 text-xs font-bold bg-[#8B2E4A] text-white hover:bg-[#72253C] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {applying ? 'Applying…' : `Apply ${checked.size} match${checked.size === 1 ? '' : 'es'}`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
