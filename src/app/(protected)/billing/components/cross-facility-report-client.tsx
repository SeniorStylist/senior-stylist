'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDollars } from '../views/billing-shared'
import { btnBase, transitionBase } from '@/lib/animations'
import type { PanelType, CrossFacilityDetailRow } from './cross-facility-panel'

const TITLES: Record<PanelType, string> = {
  outstanding: 'Outstanding Balances',
  collected: 'Collected This Month',
  invoiced: 'Invoiced This Month',
  overdue: 'Overdue Facilities',
}

const VALUE_LABELS: Record<PanelType, string> = {
  outstanding: 'Outstanding',
  collected: 'Collected',
  invoiced: 'Invoiced',
  overdue: 'Outstanding',
}

type SortKey = 'name' | 'code' | 'value' | 'daysOverdue'
type SortDir = 'asc' | 'desc'

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

function toCsv(rows: CrossFacilityDetailRow[], type: PanelType): string {
  const headers =
    type === 'overdue'
      ? ['Facility', 'Code', 'Outstanding', 'Days Overdue']
      : ['Facility', 'Code', VALUE_LABELS[type]]
  const escape = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const r of rows) {
    const values: unknown[] = [r.name, r.facilityCode ?? '', (r.valueCents / 100).toFixed(2)]
    if (type === 'overdue') values.push(r.daysOverdue ?? '')
    lines.push(values.map(escape).join(','))
  }
  return lines.join('\n')
}

export function CrossFacilityReportClient({ type }: { type: PanelType }) {
  const router = useRouter()
  const [rows, setRows] = useState<CrossFacilityDetailRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>(type === 'overdue' ? 'daysOverdue' : 'value')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/billing/cross-facility-detail?type=${type}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((body) => {
        if (cancelled) return
        setRows(body.data as CrossFacilityDetailRow[])
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [type])

  const sortedRows = useMemo(() => {
    if (!rows) return [] as CrossFacilityDetailRow[]
    const copy = [...rows]
    const dir = sortDir === 'asc' ? 1 : -1
    copy.sort((a, b) => {
      let x: string | number | null | undefined
      let y: string | number | null | undefined
      switch (sortKey) {
        case 'name':
          x = a.name
          y = b.name
          break
        case 'code':
          x = a.facilityCode
          y = b.facilityCode
          break
        case 'value':
          x = a.valueCents
          y = b.valueCents
          break
        case 'daysOverdue':
          x = a.daysOverdue ?? null
          y = b.daysOverdue ?? null
          break
      }
      if (x == null && y == null) return 0
      if (x == null) return 1
      if (y == null) return -1
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return (
        String(x).localeCompare(String(y), undefined, { numeric: sortKey === 'code' }) * dir
      )
    })
    return copy
  }, [rows, sortKey, sortDir])

  function handleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(k)
      setSortDir('desc')
    }
  }

  function downloadCsv() {
    if (!sortedRows.length) return
    const csv = toCsv(sortedRows, type)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type}-${toISODate(new Date())}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function SortHeader({
    label,
    k,
    align = 'left',
  }: {
    label: string
    k: SortKey
    align?: 'left' | 'right'
  }) {
    const isActive = sortKey === k
    const arrow = !isActive ? '↕' : sortDir === 'asc' ? '↑' : '↓'
    return (
      <button
        type="button"
        onClick={() => handleSort(k)}
        className={`${transitionBase} text-xs font-semibold text-stone-500 uppercase tracking-wide inline-flex items-center gap-1 hover:text-stone-700 ${
          align === 'right' ? 'justify-end w-full' : ''
        }`}
      >
        {label}
        <span className={isActive ? 'text-stone-700' : 'text-stone-300'}>{arrow}</span>
      </button>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-6">
        <Link
          href="/billing"
          className={`${btnBase} inline-flex items-center gap-1 text-sm font-semibold text-stone-600 hover:text-[#8B2E4A]`}
        >
          ← Back to Billing
        </Link>
        <button
          type="button"
          onClick={downloadCsv}
          disabled={!sortedRows.length}
          className={`${btnBase} rounded-xl px-4 py-2 text-sm font-semibold bg-[#8B2E4A] text-white hover:bg-[#72253C] disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          Download CSV
        </button>
      </div>

      <h1
        className="text-2xl md:text-3xl text-stone-900 mb-6"
        style={{ fontFamily: 'DM Serif Display, serif' }}
      >
        {TITLES[type]}
      </h1>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-2">
            <div className="skeleton-shimmer rounded-xl h-10" />
            <div className="skeleton-shimmer rounded-xl h-10" />
            <div className="skeleton-shimmer rounded-xl h-10" />
            <div className="skeleton-shimmer rounded-xl h-10" />
          </div>
        ) : error ? (
          <p className="p-10 text-sm text-red-600 text-center">Error: {error}</p>
        ) : !sortedRows.length ? (
          <p className="p-10 text-sm text-stone-500 text-center">
            No facilities match this view.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-12 gap-3 px-5 py-2.5 bg-stone-50 border-b border-stone-100">
              <div className="col-span-5">
                <SortHeader label="Facility" k="name" />
              </div>
              <div className="col-span-2">
                <SortHeader label="Code" k="code" />
              </div>
              <div className="col-span-3 text-right">
                <SortHeader label={VALUE_LABELS[type]} k="value" align="right" />
              </div>
              <div className="col-span-2 text-right">
                {type === 'overdue' ? (
                  <SortHeader label="Days Overdue" k="daysOverdue" align="right" />
                ) : null}
              </div>
            </div>
            {sortedRows.map((row) => {
              const valueClass =
                type === 'outstanding' || type === 'overdue'
                  ? row.valueCents > 0
                    ? 'text-sm font-semibold text-amber-700 text-right'
                    : 'text-sm text-stone-500 text-right'
                  : 'text-sm font-semibold text-stone-900 text-right'
              return (
                <button
                  key={row.facilityId}
                  type="button"
                  onClick={() => router.push(`/billing?facility=${row.facilityId}`)}
                  className={`${transitionBase} grid grid-cols-12 gap-3 px-5 py-3 border-b border-stone-50 last:border-0 hover:bg-stone-50 w-full text-left`}
                >
                  <div className="col-span-5 text-sm font-medium text-stone-900 truncate">
                    {row.name || '—'}
                  </div>
                  <div className="col-span-2 text-xs font-mono text-stone-500">
                    {row.facilityCode ?? '—'}
                  </div>
                  <div className={`col-span-3 ${valueClass}`}>
                    {formatDollars(row.valueCents)}
                  </div>
                  <div className="col-span-2 text-right">
                    {type === 'overdue' ? (
                      row.daysOverdue == null ? (
                        <span className="inline-flex items-center rounded-full bg-stone-100 text-stone-500 px-2 py-0.5 text-xs font-semibold">
                          No invoices
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-xs font-semibold">
                          {row.daysOverdue}d
                        </span>
                      )
                    ) : null}
                  </div>
                </button>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
