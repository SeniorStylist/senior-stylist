'use client'

import { useState } from 'react'
import { formatCents } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

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

interface OpenInvoice {
  id: string
  invoiceNum: string
  invoiceDate: string
  openBalanceCents: number
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
  openInvoices: OpenInvoice[]
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

              {/* Available credits — apply each to chosen open invoices */}
              {data.credits.length > 0 && (
                <div className="mb-5 rounded-xl border border-emerald-100 bg-emerald-50/50 px-4 py-3">
                  <p className="text-xs font-semibold text-emerald-800 mb-2">Available credit on account</p>
                  <div className="space-y-2">
                    {data.credits.map((c) => (
                      <CreditRow
                        key={c.id}
                        residentId={residentId}
                        credit={c}
                        openInvoices={data.openInvoices}
                        onApplied={load}
                      />
                    ))}
                  </div>
                  <p className="text-[11px] text-emerald-700 mt-2">
                    Applying records it on the site only — mirror it in QuickBooks too, or the next QB import will revert it.
                  </p>
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

function CreditRow({
  residentId,
  credit,
  openInvoices,
  onApplied,
}: {
  residentId: string
  credit: LedgerCredit
  openInvoices: OpenInvoice[]
  onApplied: () => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const apply = async () => {
    if (selected.size === 0) return
    setApplying(true)
    try {
      const res = await fetch(`/api/residents/${residentId}/credits/${credit.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: Array.from(selected) }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(`Applied ${formatCents(j.data?.appliedCents ?? 0)} to invoices`)
        setOpen(false)
        setSelected(new Set())
        onApplied()
      } else {
        toast.error(typeof j.error === 'string' ? j.error : 'Failed to apply credit')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="rounded-lg bg-white/60 border border-emerald-100 px-3 py-2">
      <div className="flex items-center justify-between text-xs text-emerald-900">
        <span>{fmtDate(credit.txnDate)}{credit.num ? ` · ${credit.num}` : ''}</span>
        <div className="flex items-center gap-2">
          <span className="font-semibold">{formatCents(credit.remainingCents)} of {formatCents(credit.amountCents)}</span>
          {openInvoices.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-[11px] font-semibold text-emerald-800 border border-emerald-200 rounded-md px-2 py-0.5 hover:bg-emerald-100"
            >
              {open ? 'Cancel' : 'Apply'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-2 pt-2 border-t border-emerald-100">
          {openInvoices.length === 0 ? (
            <p className="text-[11px] text-emerald-700">No open invoices to apply to.</p>
          ) : (
            <>
              <p className="text-[11px] text-emerald-700 mb-1.5">Choose invoices (oldest selected first):</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {openInvoices.map((inv) => (
                  <label key={inv.id} className="flex items-center gap-2 text-xs text-stone-700 cursor-pointer">
                    <input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggle(inv.id)} className="accent-[#8B2E4A]" />
                    <span className="flex-1">#{inv.invoiceNum} · {fmtDate(inv.invoiceDate)}</span>
                    <span className="font-semibold text-amber-700">{formatCents(inv.openBalanceCents)} open</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={apply}
                disabled={applying || selected.size === 0}
                className="mt-2 bg-[#8B2E4A] text-white text-[11px] font-semibold rounded-md px-3 py-1.5 hover:bg-[#72253C] disabled:opacity-50"
              >
                {applying ? 'Applying…' : `Apply credit to ${selected.size} invoice${selected.size === 1 ? '' : 's'}`}
              </button>
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
