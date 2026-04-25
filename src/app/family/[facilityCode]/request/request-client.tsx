'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { formatPricingLabel } from '@/lib/pricing'
import type { PricingTier, PricingOption } from '@/types'
import { cn } from '@/lib/utils'

interface ClientService {
  id: string
  name: string
  priceCents: number
  pricingType: string
  addonAmountCents: number | null
  pricingTiers: PricingTier[] | null
  pricingOptions: PricingOption[] | null
}

interface Props {
  facilityCode: string
  residentId: string
  groups: { category: string; services: ClientService[] }[]
}

export function RequestClient({ facilityCode, residentId, groups }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dateMode, setDateMode] = useState<'anytime' | 'range'>('anytime')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < 6) next.add(id)
      return next
    })
  }

  const onSubmit = async () => {
    if (selected.size === 0) {
      setError('Pick at least one service.')
      return
    }
    if (dateMode === 'range' && (!from || !to)) {
      setError('Pick both a start and end date, or choose Anytime.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/portal/request-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          residentId,
          serviceIds: Array.from(selected),
          preferredDateFrom: dateMode === 'range' ? from : null,
          preferredDateTo: dateMode === 'range' ? to : null,
          notes: notes.trim() || null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error ?? 'Could not submit request. Please try again.')
        return
      }
      setSuccess(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <p className="text-base font-semibold text-stone-800">Request submitted</p>
        <p className="text-sm text-stone-500 mt-1">We&apos;ll be in touch to confirm your appointment.</p>
        <div className="flex gap-2 mt-5">
          <Link
            href={`/family/${encodeURIComponent(facilityCode)}`}
            className="flex-1 text-sm font-semibold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl px-4 py-2.5 transition-colors"
          >
            Back to home
          </Link>
          <button
            type="button"
            onClick={() => {
              setSelected(new Set())
              setNotes('')
              setFrom('')
              setTo('')
              setDateMode('anytime')
              setSuccess(false)
              router.refresh()
            }}
            className="flex-1 text-sm font-semibold bg-[#8B2E4A] text-white rounded-xl px-4 py-2.5 hover:bg-[#72253C] shadow-[0_2px_6px_rgba(139,46,74,0.22)]"
          >
            Make another
          </button>
        </div>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-6 text-center">
        <p className="text-sm font-semibold text-stone-700">No services available</p>
        <p className="text-xs text-stone-400 mt-1">Please contact the office.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-900">1. Pick services</h2>
          <span className="text-xs text-stone-400">{selected.size}/6 selected</span>
        </div>
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.category}>
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-stone-400 mb-1.5">{g.category}</p>
              <div className="flex flex-col gap-1.5">
                {g.services.map((s) => {
                  const isSelected = selected.has(s.id)
                  const disabled = !isSelected && selected.size >= 6
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(s.id)}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
                        isSelected
                          ? 'border-[#8B2E4A] bg-[#F9EFF2]'
                          : 'border-stone-200 hover:bg-stone-50',
                        disabled && 'opacity-40 cursor-not-allowed',
                      )}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <span
                          className={cn(
                            'w-5 h-5 rounded-md border flex items-center justify-center shrink-0',
                            isSelected ? 'bg-[#8B2E4A] border-[#8B2E4A]' : 'border-stone-300 bg-white',
                          )}
                        >
                          {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </span>
                        <span className="text-sm font-medium text-stone-800 truncate">{s.name}</span>
                      </span>
                      <span className="text-xs font-semibold text-stone-500 shrink-0">{formatPricingLabel(s)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <h2 className="text-sm font-semibold text-stone-900 mb-3">2. Preferred date</h2>
        <div className="flex gap-2">
          {(['anytime', 'range'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setDateMode(m)}
              className={cn(
                'flex-1 text-sm font-semibold rounded-xl px-4 py-2.5 transition-colors',
                dateMode === m
                  ? 'bg-[#F9EFF2] text-[#8B2E4A] border border-[#8B2E4A]'
                  : 'bg-stone-50 text-stone-700 border border-stone-200 hover:bg-stone-100',
              )}
            >
              {m === 'anytime' ? 'Anytime' : 'Date range'}
            </button>
          ))}
        </div>
        {dateMode === 'range' && (
          <div className="grid grid-cols-2 gap-2 mt-3">
            <label className="text-xs font-semibold text-stone-600 flex flex-col gap-1.5">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
            </label>
            <label className="text-xs font-semibold text-stone-600 flex flex-col gap-1.5">
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-xl border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
            </label>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5">
        <h2 className="text-sm font-semibold text-stone-900 mb-3">3. Notes (optional)</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Anything we should know? (preferences, mobility, etc.)"
          className="w-full rounded-xl border border-stone-200 px-4 py-2.5 text-sm focus:outline-none focus:border-[#8B2E4A]/50 focus:ring-2 focus:ring-[#8B2E4A]/20 resize-none"
        />
        <p className="text-[11px] text-stone-400 text-right mt-1">{notes.length}/2000</p>
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || selected.size === 0}
        className="bg-[#8B2E4A] text-white text-sm font-semibold rounded-xl px-5 py-3 shadow-[0_2px_6px_rgba(139,46,74,0.22)] hover:bg-[#72253C] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? 'Submitting…' : 'Submit request'}
      </button>
    </div>
  )
}
