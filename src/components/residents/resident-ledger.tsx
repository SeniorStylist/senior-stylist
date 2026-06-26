'use client'

import { useState } from 'react'
import { formatCents } from '@/lib/utils'

// Mirror of canAccessBilling — replicated inline to avoid importing the
// server-only get-facility-id module into a client bundle.
function canSeeBilling(role: string): boolean {
  return role === 'admin' || role === 'super_admin' || role === 'bookkeeper'
}

interface LedgerEntry {
  id: string
  date: string
  kind: 'invoice' | 'payment'
  label: string
  detail: string | null
  chargeCents: number
  paymentCents: number
  balanceCents: number
}

interface LedgerCredit {
  id: string
  txnDate: string
  num: string | null
  amountCents: number
  remainingCents: number
}

interface LedgerData {
  summary: {
    currentBalanceCents: number
    availableCreditCents: number
    totalInvoicedCents: number
    totalPaidCents: number
  }
  entries: LedgerEntry[]
  credits: LedgerCredit[]
}

function fmtDate(d: string): string {
  // d is a YYYY-MM-DD date string — append local time so it doesn't shift a day.
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function ResidentLedger({ residentId, role }: { residentId: string; role: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<LedgerData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canSeeBilling(role)) return null

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/residents/${residentId}/ledger`)
      const j = await res.json().catch(() => ({}))
      if (res.ok) setData(j.data)
      else setError(typeof j.error === 'string' ? j.error : 'Failed to load ledger')
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !data && !loading) load()
  }

  return (
    <div className="mt-5 bg-white rounded-2xl border border-stone-100 shadow-sm">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-stone-50/60 transition-colors rounded-2xl"
      >
        <div>
          <h2 className="text-sm font-semibold text-stone-900">Account ledger</h2>
          <p className="text-xs text-stone-500 mt-0.5">Invoices, payments &amp; credits</p>
        </div>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5">
          {loading && <p className="text-sm text-stone-400 py-6 text-center">Loading…</p>}
          {error && <p className="text-sm text-red-600 py-6 text-center">{error}</p>}

          {data && !loading && (
            <>
              {/* Summary tiles */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <SummaryTile
                  label="Current balance"
                  value={formatCents(data.summary.currentBalanceCents)}
                  tone={data.summary.currentBalanceCents > 0 ? 'amber' : data.summary.currentBalanceCents < 0 ? 'sky' : 'neutral'}
                />
                <SummaryTile
                  label="Available credit"
                  value={formatCents(data.summary.availableCreditCents)}
                  tone={data.summary.availableCreditCents > 0 ? 'emerald' : 'neutral'}
                />
                <SummaryTile label="Total invoiced" value={formatCents(data.summary.totalInvoicedCents)} tone="neutral" />
                <SummaryTile label="Total paid" value={formatCents(data.summary.totalPaidCents)} tone="neutral" />
              </div>

              {/* Available credits detail */}
              {data.credits.length > 0 && (
                <div className="mb-5 rounded-xl border border-emerald-100 bg-emerald-50/50 px-4 py-3">
                  <p className="text-xs font-semibold text-emerald-800 mb-1.5">Available credit on account</p>
                  <div className="space-y-1">
                    {data.credits.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-xs text-emerald-900">
                        <span>{fmtDate(c.txnDate)}{c.num ? ` · #${c.num}` : ''}</span>
                        <span className="font-semibold">{formatCents(c.remainingCents)} of {formatCents(c.amountCents)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-emerald-700 mt-2">Apply credit to invoices from the Billing → unapplied credits screen.</p>
                </div>
              )}

              {/* Ledger table */}
              {data.entries.length === 0 ? (
                <p className="text-sm text-stone-400 py-6 text-center">No invoices or payments yet.</p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-stone-100">
                  <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 px-4 py-2 bg-stone-50/60 text-[11px] text-stone-400 uppercase tracking-wide font-semibold">
                    <span>Date</span>
                    <span>Description</span>
                    <span className="text-right">Charge</span>
                    <span className="text-right">Payment</span>
                    <span className="text-right">Balance</span>
                  </div>
                  <div className="divide-y divide-stone-50">
                    {data.entries.map((e) => (
                      <div key={`${e.kind}-${e.id}`} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 px-4 py-2.5 text-sm items-center hover:bg-[#F9EFF2] transition-colors">
                        <span className="text-stone-500 text-xs whitespace-nowrap">{fmtDate(e.date)}</span>
                        <span className="min-w-0">
                          <span className="text-stone-800">{e.label}</span>
                          {e.detail && <span className="text-stone-400 text-xs ml-1.5">· {e.detail}</span>}
                        </span>
                        <span className="text-right text-stone-700 tabular-nums">{e.chargeCents ? formatCents(e.chargeCents) : '—'}</span>
                        <span className="text-right text-emerald-700 tabular-nums">{e.paymentCents ? `(${formatCents(e.paymentCents)})` : '—'}</span>
                        <span className={`text-right font-semibold tabular-nums ${e.balanceCents > 0 ? 'text-amber-700' : e.balanceCents < 0 ? 'text-sky-700' : 'text-stone-700'}`}>
                          {formatCents(e.balanceCents)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'sky' | 'emerald' | 'neutral' }) {
  const toneClass =
    tone === 'amber' ? 'text-amber-700' : tone === 'sky' ? 'text-sky-700' : tone === 'emerald' ? 'text-emerald-700' : 'text-stone-900'
  return (
    <div className="rounded-xl border border-stone-100 bg-stone-50/40 px-3 py-2.5">
      <p className="text-[11px] text-stone-400 uppercase tracking-wide font-semibold">{label}</p>
      <p className={`text-base font-semibold mt-0.5 tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}
