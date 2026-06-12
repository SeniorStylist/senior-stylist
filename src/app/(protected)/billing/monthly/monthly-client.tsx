'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { formatDollars } from '../views/billing-shared'
import { openPeek } from '@/lib/peek-drawer'
import { expandTransition, transitionBase } from '@/lib/animations'
import { CheckImageButton } from '@/components/billing/check-image-button'

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
    hasCheckImage: boolean
  }>
  residents: MonthResident[]
  services: ServiceRow[]
}

interface MonthResident {
  residentId: string
  name: string
  roomNumber: string | null
  serviceCount: number
  servicesCents: number
  invoicedCents: number
  paidCents: number
  owedCents: number
}

interface ServiceRow {
  id: string
  date: string
  residentId: string | null
  residentName: string | null
  roomNumber: string | null
  serviceLabel: string
  amountCents: number
  paymentStatus: string | null
}

type ResidentSortKey = 'name' | 'services' | 'invoiced' | 'paid' | 'owed'

function sortResidents(
  rows: MonthResident[],
  sort: { key: ResidentSortKey; dir: 'asc' | 'desc' }
): MonthResident[] {
  const mul = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (sort.key === 'name') return mul * a.name.localeCompare(b.name)
    const field: Record<Exclude<ResidentSortKey, 'name'>, keyof MonthResident> = {
      services: 'servicesCents',
      invoiced: 'invoicedCents',
      paid: 'paidCents',
      owed: 'owedCents',
    }
    const k = field[sort.key]
    return mul * ((a[k] as number) - (b[k] as number)) || a.name.localeCompare(b.name)
  })
}

function groupServicesByDay(
  rows: ServiceRow[]
): Array<{ date: string; totalCents: number; rows: ServiceRow[] }> {
  const map = new Map<string, { date: string; totalCents: number; rows: ServiceRow[] }>()
  for (const r of rows) {
    let g = map.get(r.date)
    if (!g) {
      g = { date: r.date, totalCents: 0, rows: [] }
      map.set(r.date, g)
    }
    g.totalCents += r.amountCents
    g.rows.push(r)
  }
  // rows arrive ordered by start_time asc, so insertion order is date asc
  return [...map.values()]
}

const PAYMENT_TYPE_LABEL: Record<string, string> = {
  ip: 'IP',
  rfms: 'RFMS',
  hybrid: 'Hybrid',
  facility: 'RFMS',
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
  const [facilityCode, setFacilityCode] = useState<string | null>(null)
  const [paymentType, setPaymentType] = useState<string | null>(null)
  const [buckets, setBuckets] = useState<MonthBucket[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, MonthDetail | 'loading' | 'error'>>({})
  const [svcView, setSvcView] = useState<'resident' | 'day'>('resident')
  const [residentSort, setResidentSort] = useState<{ key: ResidentSortKey; dir: 'asc' | 'desc' }>({
    key: 'owed',
    dir: 'desc',
  })

  const [comboSearch, setComboSearch] = useState('')
  const [comboOpen, setComboOpen] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)

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
        setFacilityCode((body.data.facilityCode as string | null) ?? null)
        setPaymentType((body.data.paymentType as string | null) ?? null)
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
        <div className="flex items-center gap-2.5">
          <h1
            className="text-2xl md:text-3xl text-stone-900"
            style={{ fontFamily: 'DM Serif Display, serif' }}
          >
            Monthly Statement
          </h1>
          <button
            type="button"
            onClick={() => setLegendOpen((v) => !v)}
            aria-label="What do these numbers mean?"
            title="What do these numbers mean?"
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border transition-colors shrink-0 ${
              legendOpen
                ? 'bg-[#8B2E4A] text-white border-[#8B2E4A]'
                : 'bg-white text-stone-400 border-stone-200 hover:text-[#8B2E4A] hover:border-[#C4687A]'
            }`}
          >
            ?
          </button>
        </div>
        <Link
          href={`/billing${facilityId ? `?facility=${facilityId}` : ''}`}
          className="text-xs font-semibold text-[#8B2E4A] hover:underline"
        >
          ← Billing
        </Link>
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-5 min-h-[24px]">
        {facilityName ? (
          <>
            <span className="text-sm font-semibold text-stone-800">{facilityName}</span>
            {facilityCode && (
              <span className="text-[10.5px] font-semibold font-mono px-2.5 py-1 rounded-full bg-stone-100 text-stone-600">
                {facilityCode}
              </span>
            )}
            {paymentType && (
              <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-full bg-rose-50 text-[#8B2E4A] border border-rose-100">
                {PAYMENT_TYPE_LABEL[paymentType] ?? paymentType.toUpperCase()}
              </span>
            )}
            <span className="text-sm text-stone-500">
              — invoiced vs services vs collected, month by month.
            </span>
          </>
        ) : (
          <span className="text-sm text-stone-500">
            Invoiced vs services performed vs collected, month by month.
          </span>
        )}
      </div>

      {legendOpen && (
        <div className={`${expandTransition} bg-white rounded-2xl border border-stone-100 shadow-[var(--shadow-sm)] p-5 mb-5`}>
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-semibold text-stone-900">Reading this page</h2>
            <button
              type="button"
              onClick={() => setLegendOpen(false)}
              aria-label="Close"
              className="text-stone-400 hover:text-stone-600 transition-colors -mt-0.5"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5 mt-3">
            <div>
              <p className="text-[13px] font-semibold text-stone-800">Invoiced</p>
              <p className="text-xs text-stone-500">What was billed in QuickBooks that month.</p>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-stone-800">Services</p>
              <p className="text-xs text-stone-500">
                Completed appointments on the calendar that month (service price + add-ons). When
                this differs from Invoiced, work may be un-billed or billed in a different month.
              </p>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-emerald-700">Collected</p>
              <p className="text-xs text-stone-500">Payments received that month.</p>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-amber-700">Still owed</p>
              <p className="text-xs text-stone-500">
                Unpaid balance left on that month&apos;s invoices. A blue{' '}
                <span className="font-semibold text-sky-700">Credit</span> means the account is
                overpaid.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap mt-4 pt-3 border-t border-stone-100">
            <span className="flex items-center gap-1.5 text-xs text-stone-500">
              <span className="w-6 h-1.5 rounded-full bg-[#8B2E4A] inline-block" />
              collected share of invoiced
            </span>
            <span className="flex items-center gap-1.5 text-xs text-stone-500">
              <span className="w-6 h-1.5 rounded-full bg-amber-300 inline-block" />
              still owed
            </span>
            <span className="flex items-center gap-1.5 text-xs text-stone-500">
              <span className="w-4 h-4 rounded bg-amber-50 border border-amber-100 inline-block" />
              resident row with a balance
            </span>
          </div>
        </div>
      )}

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
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-8">
          <p className="text-sm font-semibold text-stone-700 mb-1">No months to show yet</p>
          <p className="text-sm text-stone-500">
            Months appear here as invoices and payments are imported, checks are scanned, or
            services are completed on the calendar. Everything else on the billing page —
            statements, check scanning, QuickBooks — still works for this facility.
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
                        <div className={`text-[10px] font-semibold uppercase tracking-wide ${b.openCents < 0 ? 'text-sky-600' : 'text-stone-400'}`}>
                          {b.openCents < 0 ? 'Credit' : 'Still owed'}
                        </div>
                        <div className={`text-sm font-bold ${b.openCents > 0 ? 'text-amber-700' : b.openCents < 0 ? 'text-sky-700' : 'text-stone-900'}`}>
                          {formatDollars(Math.abs(b.openCents))}
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
                        {/* By resident / By day */}
                        {(detail.residents.length > 0 || detail.services.length > 0) && (
                          <section>
                            <div className="flex items-center gap-1 mb-2">
                              {(['resident', 'day'] as const).map((v) => (
                                <button
                                  key={v}
                                  type="button"
                                  onClick={() => setSvcView(v)}
                                  className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition-colors ${
                                    svcView === v
                                      ? 'bg-[#8B2E4A] text-white'
                                      : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                                  }`}
                                >
                                  {v === 'resident' ? 'By resident' : 'By day'}
                                </button>
                              ))}
                            </div>
                            {svcView === 'resident' ? (
                              <div className="rounded-xl border border-stone-100 overflow-hidden">
                                <div className="hidden md:grid grid-cols-[1.6fr_0.9fr_0.9fr_0.9fr_0.9fr] bg-stone-50/60 px-4 py-2">
                                  {(
                                    [
                                      ['name', 'Resident', 'text-left'],
                                      ['services', 'Services', 'text-right'],
                                      ['invoiced', 'Invoiced', 'text-right'],
                                      ['paid', 'Paid', 'text-right'],
                                      ['owed', 'Owed', 'text-right'],
                                    ] as Array<[ResidentSortKey, string, string]>
                                  ).map(([key, label, align]) => (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() =>
                                        setResidentSort((s) =>
                                          s.key === key
                                            ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
                                            : { key, dir: key === 'name' ? 'asc' : 'desc' }
                                        )
                                      }
                                      className={`${align} text-[11px] uppercase tracking-wide transition-colors ${
                                        residentSort.key === key
                                          ? 'text-[#8B2E4A] font-semibold'
                                          : 'text-stone-400 hover:text-stone-600'
                                      }`}
                                    >
                                      {label}
                                      <span className="ml-0.5">
                                        {residentSort.key === key ? (residentSort.dir === 'asc' ? '↑' : '↓') : '↕'}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                                {sortResidents(detail.residents, residentSort).map((r) => (
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
                                    <span className={`text-right font-semibold ${r.owedCents > 0 ? 'text-amber-700' : r.owedCents < 0 ? 'text-sky-700' : 'text-stone-400'}`}>
                                      <span className="md:hidden text-[10px] text-stone-400 mr-1 font-normal">Owed</span>
                                      {r.owedCents > 0
                                        ? formatDollars(r.owedCents)
                                        : r.owedCents < 0
                                          ? `Credit ${formatDollars(-r.owedCents)}`
                                          : '—'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : detail.services.length === 0 ? (
                              <p className="text-sm text-stone-400">No completed services this month.</p>
                            ) : (
                              <div className="rounded-xl border border-stone-100 overflow-hidden">
                                {groupServicesByDay(detail.services).map((day) => (
                                  <Fragment key={day.date}>
                                    <div className="flex items-center justify-between px-4 py-2 bg-stone-50/60 border-t border-stone-100 first:border-t-0">
                                      <span className="text-xs font-bold text-stone-600">{shortDate(day.date)}</span>
                                      <span className="text-[11px] text-stone-400">
                                        {day.rows.length} service{day.rows.length === 1 ? '' : 's'} ·{' '}
                                        <span className="font-semibold text-stone-600">{formatDollars(day.totalCents)}</span>
                                      </span>
                                    </div>
                                    {day.rows.map((s) => (
                                      <div
                                        key={s.id}
                                        className="flex items-center gap-2 px-4 py-2 border-t border-stone-50 text-[12.5px] hover:bg-[#F9EFF2] transition-colors duration-[120ms]"
                                      >
                                        {s.residentId ? (
                                          <button
                                            type="button"
                                            onClick={() => openPeek({ type: 'resident', id: s.residentId! })}
                                            className="font-semibold text-stone-900 hover:text-[#8B2E4A] transition-colors truncate text-left shrink-0 max-w-[40%]"
                                          >
                                            {s.residentName ?? 'Unknown'}
                                            {s.roomNumber && <span className="text-stone-400 font-normal text-[11px] ml-1">Rm {s.roomNumber}</span>}
                                          </button>
                                        ) : (
                                          <span className="font-semibold text-stone-900 truncate shrink-0 max-w-[40%]">{s.residentName ?? 'Unknown'}</span>
                                        )}
                                        <span className="text-stone-500 truncate flex-1">{s.serviceLabel}</span>
                                        {s.paymentStatus === 'unpaid' && (
                                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 shrink-0">
                                            unpaid
                                          </span>
                                        )}
                                        <span className="font-semibold text-stone-900 shrink-0">{formatDollars(s.amountCents)}</span>
                                      </div>
                                    ))}
                                  </Fragment>
                                ))}
                              </div>
                            )}
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
                                      {p.hasCheckImage && <CheckImageButton paymentId={p.id} />}
                                      <span className="font-semibold text-emerald-700 shrink-0">{formatDollars(p.amountCents)}</span>
                                    </div>
                                    {p.memo && <p className="text-[11px] text-stone-400 truncate mt-0.5">{p.memo}</p>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </section>
                        </div>
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
