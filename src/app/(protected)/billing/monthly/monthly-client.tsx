'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { formatDollars } from '../views/billing-shared'
import { openPeek } from '@/lib/peek-drawer'
import { expandTransition, transitionBase } from '@/lib/animations'

interface FacilityOption {
  id: string
  name: string
  facilityCode: string | null
}

interface MonthBucket {
  month: string
  invoicedCents: number
  openCents: number
  invoiceCount: number
  paidCents: number
  paymentCount: number
  servicesCents: number
  serviceCount: number
}

interface MonthDetail {
  month: string
  invoices: Array<{
    id: string
    invoiceNum: string
    invoiceDate: string
    amountCents: number
    openBalanceCents: number
    status: string
    residentName: string | null
  }>
  payments: Array<{
    id: string
    paymentDate: string
    amountCents: number
    paymentMethod: string | null
    checkNum: string | null
    memo: string | null
    residentName: string | null
  }>
  residents: Array<{
    residentId: string
    name: string
    roomNumber: string | null
    serviceCount: number
    servicesCents: number
    invoicedCents: number
    paidCents: number
    owedCents: number
  }>
  servicesByDay: Array<{ date: string; count: number; totalCents: number }>
}

function monthLabel(month: string): string {
  return new Date(month + '-01T00:00:00').toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

function shortDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const INVOICE_STATUS_CHIP: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  partial: 'bg-amber-50 text-amber-700 border-amber-100',
  open: 'bg-stone-50 text-stone-600 border-stone-200',
  credit: 'bg-sky-50 text-sky-700 border-sky-100',
}

export function MonthlyClient({
  initialFacilityId,
  facilityOptions,
  isMaster,
}: {
  initialFacilityId: string
  facilityOptions: FacilityOption[]
  isMaster: boolean
}) {
  const searchParams = useSearchParams()
  const [facilityId, setFacilityId] = useState<string>(() => {
    const q = searchParams?.get('facility')
    if (q && (facilityOptions.length === 0 || facilityOptions.some((f) => f.id === q))) return q
    return initialFacilityId || facilityOptions[0]?.id || ''
  })

  const [facilityName, setFacilityName] = useState<string | null>(null)
  const [buckets, setBuckets] = useState<MonthBucket[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, MonthDetail | 'loading' | 'error'>>({})
  const [daysOpen, setDaysOpen] = useState<string | null>(null)

  const [comboSearch, setComboSearch] = useState('')
  const [comboOpen, setComboOpen] = useState(false)

  useEffect(() => {
    if (!facilityId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setExpanded(null)
    setDetails({})
    fetch(`/api/billing/monthly/${facilityId}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((body) => {
        if (cancelled) return
        setBuckets(body.data.buckets as MonthBucket[])
        setFacilityName(body.data.facilityName as string)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message)
        setBuckets(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [facilityId])

  async function handlePickFacility(id: string) {
    setComboOpen(false)
    setComboSearch('')
    // Bookkeepers scope facility-gated APIs through the selected_facility_id
    // cookie — sync it before fetching so guards pass.
    if (!isMaster) {
      try {
        await fetch('/api/facilities/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ facilityId: id }),
        })
      } catch { /* the monthly fetch will surface any error */ }
    }
    setFacilityId(id)
  }

  function toggleMonth(month: string) {
    if (expanded === month) {
      setExpanded(null)
      return
    }
    setExpanded(month)
    setDaysOpen(null)
    if (!details[month]) {
      setDetails((d) => ({ ...d, [month]: 'loading' }))
      fetch(`/api/billing/monthly/${facilityId}?month=${month}`)
        .then(async (r) => {
          if (!r.ok) throw new Error()
          return r.json()
        })
        .then((body) => setDetails((d) => ({ ...d, [month]: body.data as MonthDetail })))
        .catch(() => setDetails((d) => ({ ...d, [month]: 'error' })))
    }
  }

  const filteredOptions = useMemo(() => {
    const q = comboSearch.trim().toLowerCase()
    if (!q) return facilityOptions
    return facilityOptions.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.facilityCode ?? '').toLowerCase().includes(q)
    )
  }, [comboSearch, facilityOptions])

  return (
    <div className="page-enter p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h1
          className="text-2xl md:text-3xl text-stone-900"
          style={{ fontFamily: 'DM Serif Display, serif' }}
        >
          Monthly Statement
        </h1>
        <Link
          href={`/billing${facilityId ? `?facility=${facilityId}` : ''}`}
          className="text-xs font-semibold text-[#8B2E4A] hover:underline"
        >
          ← Billing
        </Link>
      </div>
      <p className="text-sm text-stone-500 mb-5">
        {facilityName ?? ' '} — invoiced vs services performed vs collected, month by month.
      </p>

      {facilityOptions.length > 1 && (
        <div className="relative max-w-xs mb-5">
          <input
            type="text"
            value={comboOpen
              ? comboSearch
              : (() => {
                  const f = facilityOptions.find((f) => f.id === facilityId)
                  return f ? (f.facilityCode ? `${f.facilityCode} · ${f.name}` : f.name) : ''
                })()
            }
            onChange={(e) => { setComboSearch(e.target.value); setComboOpen(true) }}
            onFocus={() => { setComboSearch(''); setComboOpen(true) }}
            onBlur={() => setTimeout(() => setComboOpen(false), 150)}
            placeholder="Search facilities…"
            className={`w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 focus:border-[#8B2E4A] focus:ring-2 focus:ring-[#8B2E4A]/20 focus:outline-none ${transitionBase}`}
          />
          {comboOpen && (
            <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-stone-200 rounded-xl shadow-lg z-50 max-h-64 overflow-y-auto">
              {filteredOptions.length === 0 ? (
                <p className="px-3 py-2.5 text-sm text-stone-400">No facilities found</p>
              ) : filteredOptions.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onMouseDown={() => { void handlePickFacility(f.id) }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${f.id === facilityId ? 'bg-rose-50 text-[#8B2E4A] font-medium' : 'text-stone-900 hover:bg-stone-50'}`}
                >
                  {f.facilityCode && <span className="text-stone-400 font-mono text-xs mr-1.5">{f.facilityCode} ·</span>}
                  {f.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton rounded-[18px] h-24" />
          ))}
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-10 text-center">
          <p className="text-sm text-red-600">Error loading statement: {error}</p>
        </div>
      ) : !buckets || buckets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-10 text-center">
          <p className="text-sm text-stone-500">
            No billing activity yet for this facility.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {buckets.map((b) => {
            const isOpen = expanded === b.month
            const collectRatio = b.invoicedCents > 0 ? Math.min(1, b.paidCents / b.invoicedCents) : 0
            const delta = b.servicesCents - b.invoicedCents
            const detail = details[b.month]
            return (
              <div
                key={b.month}
                className={`bg-white rounded-[18px] border shadow-[var(--shadow-sm)] overflow-hidden ${
                  isOpen ? 'border-[#8B2E4A]/20' : 'border-stone-100'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleMonth(b.month)}
                  className="w-full text-left p-4 md:p-5 hover:bg-[#F9EFF2]/50 transition-colors duration-[120ms]"
                >
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-semibold text-stone-900">
                          {monthLabel(b.month)}
                        </span>
                        <svg
                          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                          className={`text-stone-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                      <p className="text-[11.5px] text-stone-500 mt-0.5">
                        {b.invoiceCount} invoice{b.invoiceCount === 1 ? '' : 's'} · {b.paymentCount} payment{b.paymentCount === 1 ? '' : 's'} · {b.serviceCount} service{b.serviceCount === 1 ? '' : 's'}
                      </p>
                      {Math.abs(delta) > 100 && (
                        <span className="inline-flex items-center mt-1.5 text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-600">
                          Services {formatDollars(b.servicesCents)} vs invoiced {formatDollars(b.invoicedCents)}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 shrink-0">
                      <div>
                        <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Invoiced</div>
                        <div className="text-sm font-bold text-stone-900">{formatDollars(b.invoicedCents)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Services</div>
                        <div className="text-sm font-bold text-stone-900">{formatDollars(b.servicesCents)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">Collected</div>
                        <div className="text-sm font-bold text-emerald-700">{formatDollars(b.paidCents)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">Still owed</div>
                        <div className={`text-sm font-bold ${b.openCents > 0 ? 'text-amber-700' : 'text-stone-900'}`}>
                          {formatDollars(b.openCents)}
                        </div>
                      </div>
                    </div>
                  </div>
                  {b.invoicedCents > 0 && (
                    <div className="mt-3 h-1.5 rounded-full bg-stone-100 overflow-hidden flex">
                      <div
                        className="h-full bg-[#8B2E4A] rounded-full"
                        style={{ width: `${Math.round(collectRatio * 100)}%` }}
                      />
                      {b.openCents > 0 && (
                        <div
                          className="h-full bg-amber-300"
                          style={{ width: `${Math.min(100 - Math.round(collectRatio * 100), Math.round((b.openCents / b.invoicedCents) * 100))}%` }}
                        />
                      )}
                    </div>
                  )}
                </button>

                {isOpen && (
                  <div className={`${expandTransition} border-t border-stone-100 p-4 md:p-5 space-y-5`}>
                    {detail === 'loading' || !detail ? (
                      <div className="space-y-2">
                        <div className="skeleton rounded-xl h-10" />
                        <div className="skeleton rounded-xl h-10" />
                        <div className="skeleton rounded-xl h-10" />
                      </div>
                    ) : detail === 'error' ? (
                      <p className="text-sm text-red-600">Could not load this month — try again.</p>
                    ) : (
                      <>
                        {/* By resident */}
                        {detail.residents.length > 0 && (
                          <section>
                            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                              By resident
                            </h3>
                            <div className="rounded-xl border border-stone-100 overflow-hidden">
                              <div className="hidden md:grid grid-cols-[1.6fr_0.9fr_0.9fr_0.9fr_0.9fr] bg-stone-50/60 px-4 py-2 text-[11px] text-stone-400 uppercase tracking-wide">
                                <span>Resident</span>
                                <span className="text-right">Services</span>
                                <span className="text-right">Invoiced</span>
                                <span className="text-right">Paid</span>
                                <span className="text-right">Owed</span>
                              </div>
                              {detail.residents.map((r) => (
                                <div
                                  key={r.residentId}
                                  className={`grid grid-cols-2 md:grid-cols-[1.6fr_0.9fr_0.9fr_0.9fr_0.9fr] gap-y-1 px-4 py-2.5 border-t border-stone-50 text-[13px] transition-colors duration-[120ms] ${
                                    r.owedCents > 0 ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-[#F9EFF2]'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => openPeek({ type: 'resident', id: r.residentId })}
                                    className="text-left font-semibold text-stone-900 hover:text-[#8B2E4A] transition-colors truncate col-span-2 md:col-span-1"
                                  >
                                    {r.name}
                                    {r.roomNumber && <span className="text-stone-400 font-normal text-xs ml-1.5">Rm {r.roomNumber}</span>}
                                  </button>
                                  <span className="text-right text-stone-600 md:text-stone-700">
                                    <span className="md:hidden text-[10px] text-stone-400 mr-1">Svc</span>
                                    {r.serviceCount > 0 ? `${formatDollars(r.servicesCents)}` : '—'}
                                  </span>
                                  <span className="text-right text-stone-700">
                                    <span className="md:hidden text-[10px] text-stone-400 mr-1">Inv</span>
                                    {r.invoicedCents > 0 ? formatDollars(r.invoicedCents) : '—'}
                                  </span>
                                  <span className="text-right text-emerald-700">
                                    <span className="md:hidden text-[10px] text-stone-400 mr-1">Paid</span>
                                    {r.paidCents > 0 ? formatDollars(r.paidCents) : '—'}
                                  </span>
                                  <span className={`text-right font-semibold ${r.owedCents > 0 ? 'text-amber-700' : 'text-stone-400'}`}>
                                    <span className="md:hidden text-[10px] text-stone-400 mr-1 font-normal">Owed</span>
                                    {r.owedCents > 0 ? formatDollars(r.owedCents) : '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </section>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                          {/* Invoices */}
                          <section>
                            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                              Invoices ({detail.invoices.length})
                            </h3>
                            {detail.invoices.length === 0 ? (
                              <p className="text-sm text-stone-400">No invoices this month.</p>
                            ) : (
                              <div className="rounded-xl border border-stone-100 overflow-hidden max-h-72 overflow-y-auto">
                                {detail.invoices.map((inv) => (
                                  <div key={inv.id} className="flex items-center gap-2 px-3.5 py-2 border-t border-stone-50 first:border-t-0 text-[12.5px] hover:bg-[#F9EFF2] transition-colors duration-[120ms]">
                                    <span className="font-mono text-stone-500 text-[11px] shrink-0">{inv.invoiceNum}</span>
                                    <span className="text-stone-400 text-[11px] shrink-0">{shortDate(inv.invoiceDate)}</span>
                                    <span className="text-stone-700 truncate flex-1">{inv.residentName ?? '—'}</span>
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 capitalize ${INVOICE_STATUS_CHIP[inv.status] ?? INVOICE_STATUS_CHIP.open}`}>
                                      {inv.status}
                                    </span>
                                    <span className="font-semibold text-stone-900 shrink-0">{formatDollars(inv.amountCents)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </section>

                          {/* Payments */}
                          <section>
                            <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                              Payments ({detail.payments.length})
                            </h3>
                            {detail.payments.length === 0 ? (
                              <p className="text-sm text-stone-400">No payments received this month.</p>
                            ) : (
                              <div className="rounded-xl border border-stone-100 overflow-hidden max-h-72 overflow-y-auto">
                                {detail.payments.map((p) => (
                                  <div key={p.id} className="px-3.5 py-2 border-t border-stone-50 first:border-t-0 text-[12.5px] hover:bg-[#F9EFF2] transition-colors duration-[120ms]">
                                    <div className="flex items-center gap-2">
                                      <span className="text-stone-400 text-[11px] shrink-0">{shortDate(p.paymentDate)}</span>
                                      <span className="text-stone-700 truncate flex-1">{p.residentName ?? 'Facility'}</span>
                                      {(p.paymentMethod || p.checkNum) && (
                                        <span className="text-[10px] text-stone-400 shrink-0">
                                          {p.paymentMethod ?? 'check'}{p.checkNum ? ` #${p.checkNum}` : ''}
                                        </span>
                                      )}
                                      <span className="font-semibold text-emerald-700 shrink-0">{formatDollars(p.amountCents)}</span>
                                    </div>
                                    {p.memo && <p className="text-[11px] text-stone-400 truncate mt-0.5">{p.memo}</p>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </section>
                        </div>

                        {/* Services by day */}
                        {detail.servicesByDay.length > 0 && (
                          <section>
                            <button
                              type="button"
                              onClick={() => setDaysOpen(daysOpen === b.month ? null : b.month)}
                              className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2 flex items-center gap-1.5 hover:text-stone-700 transition-colors"
                            >
                              Services by day ({detail.servicesByDay.length})
                              <svg
                                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                className={`transition-transform duration-200 ${daysOpen === b.month ? 'rotate-180' : ''}`}
                              >
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>
                            {daysOpen === b.month && (
                              <div className={`${expandTransition} rounded-xl border border-stone-100 overflow-hidden`}>
                                {detail.servicesByDay.map((d) => (
                                  <div key={d.date} className="flex items-center justify-between px-3.5 py-2 border-t border-stone-50 first:border-t-0 text-[12.5px] hover:bg-[#F9EFF2] transition-colors duration-[120ms]">
                                    <span className="text-stone-700">{shortDate(d.date)}</span>
                                    <span className="text-stone-400 text-[11px]">{d.count} service{d.count === 1 ? '' : 's'}</span>
                                    <span className="font-semibold text-stone-900">{formatDollars(d.totalCents)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </section>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
