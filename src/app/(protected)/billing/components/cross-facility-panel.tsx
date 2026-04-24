'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { formatDollars } from '../views/billing-shared'
import { btnBase, transitionBase } from '@/lib/animations'
import type { ScanResult } from './scan-check-modal'

export type PanelType = 'outstanding' | 'collected' | 'invoiced' | 'overdue' | 'unresolved'

export interface CrossFacilityDetailRow {
  facilityId: string
  facilityCode: string | null
  name: string
  valueCents: number
  daysOverdue?: number | null
}

export interface UnresolvedRow {
  id: string
  facilityId: string | null
  facilityName: string | null
  facilityCode: string | null
  checkImageUrl: string | null
  createdAt: string | null
  extractedCheckNum: string | null
  extractedCheckDate: string | null
  extractedAmountCents: number | null
  extractedPayerName: string | null
  extractedInvoiceRef: string | null
  extractedInvoiceDate: string | null
  extractedResidentLines: Array<{
    rawName: string
    amountCents: number
    serviceCategory: string | null
    residentId: string | null
    matchConfidence: 'high' | 'medium' | 'low' | 'none'
  }> | null
  confidenceOverall: 'high' | 'medium' | 'low' | null
  unresolvedReason: string | null
  rawOcrJson: Record<string, unknown> | null
}

const TITLES: Record<PanelType, string> = {
  outstanding: 'Total Outstanding',
  collected: 'Collected This Month',
  invoiced: 'Invoiced This Month',
  overdue: 'Facilities Overdue',
  unresolved: 'Unresolved Scans',
}

const VALUE_LABELS: Record<PanelType, string> = {
  outstanding: 'Outstanding',
  collected: 'Collected',
  invoiced: 'Invoiced',
  overdue: 'Outstanding',
  unresolved: 'Amount',
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

export function CrossFacilityPanel({
  type,
  facilityId,
  onClose,
  onSelectFacility,
  onResolveUnresolved,
}: {
  type: PanelType
  facilityId?: string | null
  onClose: () => void
  onSelectFacility: (id: string) => void
  onResolveUnresolved?: (row: UnresolvedRow, scanResult: ScanResult) => void
}) {
  const [rows, setRows] = useState<CrossFacilityDetailRow[] | null>(null)
  const [unresolvedRows, setUnresolvedRows] = useState<UnresolvedRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const url =
      type === 'unresolved'
        ? `/api/billing/unresolved${facilityId ? `?facilityId=${facilityId}` : ''}`
        : `/api/billing/cross-facility-detail?type=${type}`
    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error ?? `HTTP ${r.status}`)
        }
        return r.json()
      })
      .then((body) => {
        if (cancelled) return
        if (type === 'unresolved') {
          setUnresolvedRows(body.data as UnresolvedRow[])
        } else {
          setRows(body.data as CrossFacilityDetailRow[])
        }
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
  }, [type, facilityId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleResolveClick(row: UnresolvedRow) {
    if (!onResolveUnresolved) return
    // Reshape the saved unresolved record into a ScanResult the modal can consume
    const reshaped: ScanResult = {
      imageUrl: row.checkImageUrl ?? null,
      storagePath: null,
      unresolvable: false,
      unresolvableReason: row.unresolvedReason,
      documentType: 'UNKNOWN',
      extracted: {
        checkNum: { value: row.extractedCheckNum ?? null, confidence: 'medium' },
        checkDate: { value: row.extractedCheckDate ?? null, confidence: 'medium' },
        amountCents: { value: row.extractedAmountCents ?? null, confidence: 'medium' },
        payerName: { value: row.extractedPayerName ?? null, confidence: 'medium' },
        payerAddress: { value: null, confidence: 'medium' },
        invoiceRef: { value: row.extractedInvoiceRef ?? null, confidence: 'medium' },
        invoiceDate: { value: row.extractedInvoiceDate ?? null, confidence: 'medium' },
        memo: { value: null, confidence: 'medium' },
      },
      facilityMatch: {
        facilityId: row.facilityId,
        name: row.facilityName,
        facilityCode: row.facilityCode,
        confidence: row.facilityId ? 'medium' : 'none',
      },
      residentMatches: (row.extractedResidentLines ?? []).map((l) => ({
        rawName: l.rawName,
        amountCents: l.amountCents,
        serviceCategory: l.serviceCategory,
        residentId: l.residentId,
        residentName: null,
        matchConfidence: l.matchConfidence,
      })),
      invoiceMatch: { confidence: 'none', matchedInvoiceIds: [], totalOpenCents: 0, remainingCents: 0 },
      cashAlsoReceivedCents: null,
      invoiceLines: [],
      rawOcrJson: row.rawOcrJson ?? {},
      overallConfidence: row.confidenceOverall ?? 'low',
    }
    onResolveUnresolved(row, reshaped)
  }

  const valueLabel = VALUE_LABELS[type]

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h2
            className="text-xl md:text-2xl text-stone-900"
            style={{ fontFamily: 'DM Serif Display, serif' }}
          >
            {TITLES[type]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={`${btnBase} rounded-full w-8 h-8 flex items-center justify-center text-stone-500 hover:bg-stone-100`}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="space-y-2">
              <div className="skeleton-shimmer rounded-xl h-12" />
              <div className="skeleton-shimmer rounded-xl h-12" />
              <div className="skeleton-shimmer rounded-xl h-12" />
              <div className="skeleton-shimmer rounded-xl h-12" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-600">Error: {error}</p>
          ) : type === 'unresolved' ? (
            !unresolvedRows || unresolvedRows.length === 0 ? (
              <p className="text-sm text-stone-500 text-center py-10">
                No unresolved scans. Everything is matched.
              </p>
            ) : (
              <div className="rounded-2xl border border-stone-100 overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-stone-50 border-b border-stone-100 text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                  <div className="col-span-2">Scanned</div>
                  <div className="col-span-3">Facility</div>
                  <div className="col-span-2 text-right">{valueLabel}</div>
                  <div className="col-span-3">Reason</div>
                  <div className="col-span-2 text-right">Action</div>
                </div>
                {unresolvedRows.map((row) => (
                  <div
                    key={row.id}
                    className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-stone-50 last:border-0 text-sm items-center"
                  >
                    <div className="col-span-2 text-stone-600 text-xs">
                      {formatDate(row.createdAt)}
                    </div>
                    <div className="col-span-3 truncate">
                      <div className="text-stone-900 font-medium truncate">
                        {row.facilityName ?? 'Unknown'}
                      </div>
                      {row.facilityCode ? (
                        <div className="text-[11px] text-stone-500 font-mono">
                          {row.facilityCode}
                        </div>
                      ) : null}
                    </div>
                    <div className="col-span-2 text-right text-stone-900 font-semibold">
                      {formatDollars(row.extractedAmountCents ?? 0)}
                    </div>
                    <div className="col-span-3 text-xs text-stone-500 truncate" title={row.unresolvedReason ?? ''}>
                      {row.unresolvedReason ?? '—'}
                    </div>
                    <div className="col-span-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleResolveClick(row)}
                        className={`${btnBase} rounded-lg px-2 py-1 text-xs font-semibold bg-[#8B2E4A] text-white hover:bg-[#72253C]`}
                      >
                        Resolve →
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : !rows || rows.length === 0 ? (
            <p className="text-sm text-stone-500 text-center py-10">
              No facilities match this view.
            </p>
          ) : (
            <div className="rounded-2xl border border-stone-100 overflow-hidden">
              <div className="grid gap-3 px-4 py-2 bg-stone-50 border-b border-stone-100 grid-cols-12">
                <div className="col-span-5 text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                  Facility
                </div>
                <div className="col-span-2 text-[11px] font-semibold text-stone-500 uppercase tracking-wide">
                  Code
                </div>
                <div className="col-span-3 text-[11px] font-semibold text-stone-500 uppercase tracking-wide text-right">
                  {valueLabel}
                </div>
                {type === 'overdue' ? (
                  <div className="col-span-2 text-[11px] font-semibold text-stone-500 uppercase tracking-wide text-right">
                    Days Overdue
                  </div>
                ) : (
                  <div className="col-span-2" />
                )}
              </div>
              {rows.map((row) => {
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
                    onClick={() => onSelectFacility(row.facilityId)}
                    className={`transition-colors duration-[120ms] ease-out grid grid-cols-12 gap-3 px-4 py-3 border-b border-stone-50 last:border-0 hover:bg-stone-50 w-full text-left`}
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
                    {type === 'overdue' ? (
                      <div className="col-span-2 text-right">
                        {row.daysOverdue == null ? (
                          <span className="inline-flex items-center rounded-full bg-stone-100 text-stone-500 px-2 py-0.5 text-xs font-semibold">
                            No invoices
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-xs font-semibold">
                            {row.daysOverdue}d
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="col-span-2" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {type !== 'unresolved' && (
          <div className="px-5 py-4 border-t border-stone-100 flex items-center justify-end">
            <Link
              href={`/billing/${type}`}
              className={`${btnBase} inline-flex items-center gap-1 text-sm font-semibold text-[#8B2E4A] hover:text-[#72253C]`}
            >
              View Full Report →
            </Link>
          </div>
        )}
      </div>
    </>
  )
}
