'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { addDays, endOfMonth, format } from 'date-fns'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

export interface PayPeriodSummary {
  id: string
  periodType: string
  startDate: string
  endDate: string
  status: string
  notes: string | null
  stylistCount: number
  totalPayoutCents: number
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  open: { label: 'Open', className: 'bg-teal-50 text-teal-700' },
  processing: { label: 'Processing', className: 'bg-amber-50 text-amber-700' },
  paid: { label: 'Paid', className: 'bg-emerald-50 text-emerald-700' },
}

const PERIOD_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`)
  const e = new Date(`${end}T00:00:00`)
  const sameYear = s.getFullYear() === e.getFullYear()
  const left = format(s, sameYear ? 'MMM d' : 'MMM d, yyyy')
  const right = format(e, 'MMM d, yyyy')
  return `${left} – ${right}`
}

function computeEndDate(startStr: string, type: string): string {
  if (!startStr) return ''
  const start = new Date(`${startStr}T00:00:00`)
  if (Number.isNaN(start.getTime())) return ''
  const end =
    type === 'weekly'
      ? addDays(start, 6)
      : type === 'biweekly'
        ? addDays(start, 13)
        : endOfMonth(start)
  return format(end, 'yyyy-MM-dd')
}

export function PayrollListClient({
  initialPeriods,
}: {
  initialPeriods: PayPeriodSummary[]
}) {
  const router = useRouter()
  const [periods, setPeriods] = useState<PayPeriodSummary[]>(initialPeriods)
  const [modalOpen, setModalOpen] = useState(false)
  const [periodType, setPeriodType] = useState<'weekly' | 'biweekly' | 'monthly'>('monthly')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [endEdited, setEndEdited] = useState(false)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalPayout = useMemo(
    () => periods.reduce((s, p) => s + p.totalPayoutCents, 0),
    [periods],
  )

  const openModal = () => {
    setPeriodType('monthly')
    setStartDate('')
    setEndDate('')
    setEndEdited(false)
    setNotes('')
    setError(null)
    setModalOpen(true)
  }

  const handleStartChange = (v: string) => {
    setStartDate(v)
    if (!endEdited) setEndDate(computeEndDate(v, periodType))
  }

  const handleTypeChange = (t: 'weekly' | 'biweekly' | 'monthly') => {
    setPeriodType(t)
    if (!endEdited && startDate) setEndDate(computeEndDate(startDate, t))
  }

  const handleSubmit = async () => {
    if (submitting) return
    if (!startDate || !endDate) {
      setError('Start and end dates are required')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/pay-periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodType,
          startDate,
          endDate,
          notes: notes.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(typeof json?.error === 'string' ? json.error : 'Failed to create pay period')
        return
      }
      const p = json.data.period
      setPeriods((prev) =>
        [
          {
            id: p.id,
            periodType: p.periodType,
            startDate: p.startDate,
            endDate: p.endDate,
            status: p.status,
            notes: p.notes,
            stylistCount: json.data.itemCount,
            totalPayoutCents: 0,
          },
          ...prev,
        ].sort((a, b) => b.startDate.localeCompare(a.startDate)),
      )
      setModalOpen(false)
      router.push(`/payroll/${p.id}`)
    } catch (err) {
      console.error(err)
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page-enter p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif text-stone-900">Payroll</h1>
          <p className="text-sm text-stone-500 mt-1">
            {periods.length} pay {periods.length === 1 ? 'period' : 'periods'}
            {periods.length > 0 && (
              <>
                {' · '}
                <span>{formatDollars(totalPayout)} total net payout</span>
              </>
            )}
          </p>
        </div>
        <Button onClick={openModal}>+ New Pay Period</Button>
      </div>

      {periods.length === 0 ? (
        <div className="rounded-2xl border border-stone-200 bg-white p-12 text-center">
          <p className="text-stone-500 text-sm">No pay periods yet.</p>
          <p className="text-stone-400 text-xs mt-2">
            Create your first pay period to calculate commissions from completed bookings.
          </p>
        </div>
      ) : (
        <div className="rounded-[18px] border border-stone-200 bg-white overflow-hidden shadow-[var(--shadow-sm)]">
          <div className="hidden md:grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-5 py-3 border-b border-stone-200 bg-stone-50/60 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
            <div>Period</div>
            <div>Type</div>
            <div>Status</div>
            <div>Stylists</div>
            <div>Net Payout</div>
          </div>
          {periods.map((p) => {
            const badge = STATUS_BADGE[p.status] ?? {
              label: p.status,
              className: 'bg-stone-100 text-stone-700',
            }
            return (
              <button
                key={p.id}
                onClick={() => router.push(`/payroll/${p.id}`)}
                className="group w-full text-left md:grid md:grid-cols-[2fr_1fr_1fr_1fr_1fr] md:gap-4 flex flex-col gap-1.5 px-5 py-3.5 border-b border-stone-100 last:border-b-0 hover:bg-[#F9EFF2] transition-colors duration-[120ms] ease-out"
              >
                <div className="text-[13.5px] text-stone-900 font-semibold leading-snug">
                  {formatRange(p.startDate, p.endDate)}
                </div>
                <div className="text-[11.5px] text-stone-500 leading-snug">
                  {PERIOD_LABEL[p.periodType] ?? p.periodType}
                </div>
                <div>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-semibold ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </div>
                <div className="text-sm text-stone-600">{p.stylistCount}</div>
                <div className="text-sm font-semibold text-stone-900">
                  {formatDollars(p.totalPayoutCents)}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => !submitting && setModalOpen(false)} title="New Pay Period">
        {submitting ? (
          <div className="p-8 flex flex-col items-center gap-4">
            <svg className="animate-spin h-8 w-8 text-[#8B2E4A]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <div className="text-sm font-medium text-stone-900">Calculating payroll...</div>
            <div className="text-xs text-stone-500 text-center max-w-xs">
              Scanning completed bookings and computing commission for each stylist.
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Period Type
              </label>
              <select
                value={periodType}
                onChange={(e) => handleTypeChange(e.target.value as 'weekly' | 'biweekly' | 'monthly')}
                className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => handleStartChange(e.target.value)}
                className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value)
                  setEndEdited(true)
                }}
                className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                maxLength={2000}
                className="bg-stone-50 border border-stone-200 rounded-xl px-3.5 py-2.5 text-sm text-stone-900 focus:outline-none focus:bg-white focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 resize-none"
              />
            </div>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="sticky bottom-0 -mx-6 px-6 pt-3 pb-4 border-t border-stone-100 bg-white flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!startDate || !endDate}>
                Create
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
