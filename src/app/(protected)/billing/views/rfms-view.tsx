'use client'

import { Fragment, useState } from 'react'
import {
  BillingFacility,
  BillingInvoice,
  BillingPayment,
  BillingResident,
  RemittanceLine,
  computeResidentTotals,
  formatDollars,
  formatInvoiceDate,
  formatShortDate,
} from './billing-shared'
import { ExpandableSection } from './expandable-section'
import { btnBase, expandTransition } from '@/lib/animations'
import { Avatar } from '@/components/ui/avatar'

export function RFMSView({
  facility,
  residents,
  invoices,
  payments,
  residentsTitle = 'Residents',
  checksTitle = 'Checks received',
  checksDefaultOpen = false,
  residentsDefaultOpen = false,
  onPaymentUpdated,
}: {
  facility: BillingFacility
  residents: BillingResident[]
  invoices: BillingInvoice[]
  payments: BillingPayment[]
  residentsTitle?: string
  checksTitle?: string
  checksDefaultOpen?: boolean
  residentsDefaultOpen?: boolean
  onPaymentUpdated?: (payment: BillingPayment) => void
}) {
  const [expandedCheckId, setExpandedCheckId] = useState<string | null>(null)
  const [reconciling, setReconciling] = useState<Record<string, boolean>>({})
  const [reconcileErrors, setReconcileErrors] = useState<Record<string, string>>({})
  const [filterFlaggedOnly, setFilterFlaggedOnly] = useState(false)

  function getRemittanceLines(p: BillingPayment): RemittanceLine[] | null {
    const bd = p.residentBreakdown
    if (bd && !Array.isArray(bd) && (bd as { type?: string }).type === 'remittance_lines') {
      return (bd as { type: string; lines: RemittanceLine[] }).lines
    }
    return null
  }

  async function handleReconcile(p: BillingPayment) {
    setReconciling((s) => ({ ...s, [p.id]: true }))
    setReconcileErrors((s) => {
      const { [p.id]: _drop, ...rest } = s
      return rest
    })
    try {
      const res = await fetch(`/api/billing/reconcile/${p.id}`, { method: 'POST' })
      const body = await res.json()
      if (!res.ok) {
        setReconcileErrors((s) => ({ ...s, [p.id]: body?.error ?? 'Reconcile failed' }))
        return
      }
      onPaymentUpdated?.({
        ...p,
        reconciliationStatus: body.data.status,
        reconciliationLines: body.data.lines,
        reconciliationNotes: body.data.notes,
        reconciledAt: new Date().toISOString(),
      })
    } catch (err) {
      setReconcileErrors((s) => ({ ...s, [p.id]: (err as Error).message ?? 'Network error' }))
    } finally {
      setReconciling((s) => ({ ...s, [p.id]: false }))
    }
  }

  // Reconciliation summary across remittance-slip payments only
  const remittancePayments = payments.filter((p) => getRemittanceLines(p) !== null)
  const reconciledCount = remittancePayments.filter((p) => p.reconciliationStatus === 'reconciled').length
  const partialCount = remittancePayments.filter((p) => p.reconciliationStatus === 'partial').length
  const flaggedCount = remittancePayments.filter((p) => p.reconciliationStatus === 'flagged').length
  const showReconciliationSummary = remittancePayments.length > 0

  const visiblePayments = filterFlaggedOnly
    ? payments.filter((p) => p.reconciliationStatus === 'flagged' || p.reconciliationStatus === 'partial')
    : payments

  const totalReceived = payments.reduce((s, p) => s + p.amountCents, 0)
  const outstanding = residents.reduce(
    (s, r) => s + (r.qbOutstandingBalanceCents ?? 0),
    0
  )

  const checkWord = payments.length === 1 ? 'check' : 'checks'
  const residentWord = residents.length === 1 ? 'resident' : 'residents'

  return (
    <div className="space-y-4">
      <ExpandableSection
        title={checksTitle}
        meta={`${payments.length} ${checkWord} · ${formatDollars(totalReceived)} received`}
        defaultOpen={checksDefaultOpen}
      >
        {showReconciliationSummary && (
          <div className="px-5 py-2.5 border-b border-stone-100 bg-stone-50/40 flex items-center gap-2 text-xs text-stone-500">
            <span className="font-semibold text-stone-600">Reconciliation:</span>
            <span><span className="font-semibold text-emerald-700">{reconciledCount}</span> reconciled</span>
            <span className="text-stone-300">·</span>
            <span><span className="font-semibold text-amber-700">{partialCount}</span> partial</span>
            <span className="text-stone-300">·</span>
            <span><span className="font-semibold text-red-700">{flaggedCount}</span> flagged</span>
            {(flaggedCount > 0 || partialCount > 0) && (
              <button
                type="button"
                onClick={() => setFilterFlaggedOnly((v) => !v)}
                className="ml-auto text-[#8B2E4A] hover:text-[#72253C] font-medium"
              >
                {filterFlaggedOnly ? 'Show all' : 'View flagged →'}
              </button>
            )}
          </div>
        )}
        {payments.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-stone-500">
            No checks recorded for this facility yet.
          </div>
        ) : (
          <>
            <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-200 bg-stone-50/60">
              <div className="col-span-2 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                Date
              </div>
              <div className="col-span-3 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                Check #
              </div>
              <div className="col-span-2 text-[11px] font-semibold text-stone-400 uppercase tracking-wide text-right">
                Amount
              </div>
              <div className="col-span-5 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                Memo / Invoice Ref
              </div>
            </div>
            {(() => {
              let lastYear: number | null = null
              return visiblePayments.map((p) => {
                const year = new Date(`${p.paymentDate}T00:00:00`).getFullYear()
                const showYear = !Number.isNaN(year) && year !== lastYear
                if (showYear) lastYear = year
                return (
                  <Fragment key={p.id}>
                    {showYear && (
                      <div className="px-5 pt-4 pb-1 border-b border-stone-50">
                        <span className="text-xs font-bold text-stone-400 uppercase tracking-widest">
                          {year}
                        </span>
                      </div>
                    )}
                    <div className="md:grid md:grid-cols-12 md:gap-4 md:items-center flex flex-col gap-1 px-5 py-3 border-b border-stone-50 last:border-0">
                      <div className="md:col-span-2 text-sm text-stone-700">
                        {formatInvoiceDate(p.paymentDate)}
                      </div>
                      <div className="md:col-span-3 text-sm text-stone-900 font-medium">
                        {(() => {
                          const remLines = getRemittanceLines(p)
                          return remLines ? (
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedCheckId(expandedCheckId === p.id ? null : p.id)
                              }
                              className={`${btnBase} text-stone-700 underline decoration-dotted hover:text-stone-900`}
                            >
                              {p.checkNum ?? '—'}
                            </button>
                          ) : (
                            p.checkNum ?? <span className="text-stone-400">—</span>
                          )
                        })()}
                      </div>
                      <div className="md:col-span-2 text-sm font-semibold text-stone-900 md:text-right">
                        {formatDollars(p.amountCents)}
                      </div>
                      <div className="md:col-span-5 text-sm text-stone-500 flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-center gap-2 truncate">
                          <span className="truncate">
                            {p.memo ?? p.invoiceRef ?? (
                              <span className="text-stone-400">—</span>
                            )}
                          </span>
                          {p.reconciliationStatus && p.reconciliationStatus !== 'unreconciled' && (
                            <ReconciliationPill status={p.reconciliationStatus} />
                          )}
                        </div>
                        {p.revShareAmountCents != null &&
                          p.revShareAmountCents > 0 &&
                          (facility.revSharePercentage ?? 0) > 0 && (
                            <RevShareSubRows
                              seniorStylistCents={p.seniorStylistAmountCents ?? p.amountCents - p.revShareAmountCents}
                              facilityShareCents={p.revShareAmountCents}
                              percentage={facility.revSharePercentage ?? 0}
                              type={p.revShareType ?? facility.qbRevShareType}
                            />
                          )}
                      </div>
                    </div>
                    {expandedCheckId === p.id && (() => {
                      const lines = getRemittanceLines(p)!
                      const lineTotal = lines.reduce((s, l) => s + l.amountCents, 0)
                      return (
                        <div className={`${expandTransition} px-5 py-3 bg-stone-50 border-b border-stone-100`}>
                          <div className="hidden md:grid grid-cols-[6rem_1fr_6rem] gap-x-4 text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">
                            <span>Ref #</span>
                            <span>Date</span>
                            <span className="text-right">Amount</span>
                          </div>
                          {lines.map((l, i) => (
                            <div key={i} className="grid grid-cols-[6rem_1fr_6rem] gap-x-4 py-1 text-sm">
                              <span className="text-stone-600 font-mono text-xs">{l.ref ?? '—'}</span>
                              <span className="text-stone-600">
                                {l.invoiceDate
                                  ? new Date(`${l.invoiceDate}T00:00:00`).toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      year: 'numeric',
                                    })
                                  : '—'}
                              </span>
                              <span className="text-stone-800 font-medium text-right tabular-nums">
                                {formatDollars(l.amountCents)}
                              </span>
                            </div>
                          ))}
                          <div className="border-t border-stone-200 mt-2 pt-2 flex justify-between text-sm">
                            <span className="text-stone-500 font-semibold">Total</span>
                            <span
                              className={`font-bold tabular-nums ${lineTotal === p.amountCents ? 'text-emerald-700' : 'text-amber-700'}`}
                            >
                              {formatDollars(lineTotal)}
                            </span>
                          </div>

                          <ReconciliationPanel
                            payment={p}
                            reconciling={!!reconciling[p.id]}
                            errorMsg={reconcileErrors[p.id] ?? null}
                            onReconcile={() => handleReconcile(p)}
                            facilityTimezone={facility.timezone}
                          />
                        </div>
                      )
                    })()}
                  </Fragment>
                )
              })
            })()}
          </>
        )}
      </ExpandableSection>

      <ExpandableSection
        title={residentsTitle}
        meta={`${residents.length} ${residentWord} · ${formatDollars(outstanding)} outstanding`}
        defaultOpen={residentsDefaultOpen}
      >
        {residents.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-stone-500">
            No residents set up for this facility yet.
          </div>
        ) : (
          <>
            <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-200 bg-stone-50/60">
              <div className="col-span-4 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                Resident
              </div>
              <div className="col-span-1 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                Room
              </div>
              <div className="col-span-2 text-[11px] font-semibold text-stone-400 uppercase tracking-wide">
                Last Service
              </div>
              <div className="col-span-2 text-[11px] font-semibold text-stone-400 uppercase tracking-wide text-right">
                Billed
              </div>
              <div className="col-span-3 text-[11px] font-semibold text-stone-400 uppercase tracking-wide text-right">
                Outstanding
              </div>
            </div>
            {residents.map((r) => {
              const t = computeResidentTotals(r, invoices)
              const outstandingClass =
                t.outstandingCents > 0
                  ? 'text-sm font-semibold text-amber-700 md:text-right balance-attention'
                  : 'text-sm text-stone-500 md:text-right'
              const rowTintClass = t.outstandingCents > 0
                ? 'bg-amber-50/40 hover:bg-amber-50/70'
                : 'hover:bg-[#F9EFF2]'
              return (
                <div
                  key={r.id}
                  className={`group md:grid md:grid-cols-12 md:gap-4 md:items-center flex flex-col gap-1.5 px-5 py-3.5 border-b border-stone-50 last:border-0 transition-colors duration-[120ms] ease-out ${rowTintClass}`}
                >
                  <div className="md:col-span-4 flex items-center gap-3 min-w-0">
                    <Avatar name={r.name} size="md" />
                    <span className="text-[13.5px] font-semibold text-stone-900 leading-snug truncate">
                      {r.name}
                    </span>
                  </div>
                  <div className="md:col-span-1 text-[11.5px] text-stone-500 leading-snug">
                    {r.roomNumber ?? '—'}
                  </div>
                  <div className="md:col-span-2 text-[11.5px] text-stone-500 leading-snug">
                    {formatShortDate(t.lastServiceDate)}
                  </div>
                  <div className="md:col-span-2 text-sm text-stone-700 md:text-right">
                    {formatDollars(t.billedCents)}
                  </div>
                  <div className={`md:col-span-3 ${outstandingClass}`}>
                    {formatDollars(t.outstandingCents)}
                  </div>
                </div>
              )
            })}
          </>
        )}
      </ExpandableSection>
    </div>
  )
}

function RevShareSubRows({
  seniorStylistCents,
  facilityShareCents,
  percentage,
  type,
}: {
  seniorStylistCents: number
  facilityShareCents: number
  percentage: number
  type: string | null | undefined
}) {
  const seniorPct = 100 - percentage
  const typeLabel = type === 'facility_deducts' ? 'facility deducts' : 'we deduct'
  return (
    <div className="text-xs text-stone-400 leading-tight space-y-0.5">
      <div className="flex items-center gap-1.5">
        <span>Senior Stylist: {formatDollars(seniorStylistCents)}</span>
        <span className="bg-stone-100 text-stone-600 rounded-full px-2 py-0.5 text-[10px] font-semibold">
          {seniorPct}%
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span>Facility share: {formatDollars(facilityShareCents)}</span>
        <span className="bg-stone-100 text-stone-600 rounded-full px-2 py-0.5 text-[10px] font-semibold">
          {percentage}%
        </span>
        <span className="text-stone-400">· {typeLabel}</span>
      </div>
    </div>
  )
}

function ReconciliationPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    reconciled: { cls: 'bg-emerald-50 text-emerald-700', label: '✓ Reconciled' },
    partial: { cls: 'bg-amber-50 text-amber-700', label: '⚠ Partial' },
    flagged: { cls: 'bg-red-50 text-red-700', label: '⚠ Flagged' },
  }
  const m = map[status]
  if (!m) return null
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${m.cls}`}>
      {m.label}
    </span>
  )
}

function ReconciliationPanel({
  payment,
  reconciling,
  errorMsg,
  onReconcile,
  facilityTimezone,
}: {
  payment: BillingPayment
  reconciling: boolean
  errorMsg: string | null
  onReconcile: () => void
  facilityTimezone: string
}) {
  const status = payment.reconciliationStatus ?? 'unreconciled'
  const lines = payment.reconciliationLines ?? []

  if (status === 'unreconciled') {
    return (
      <div className="mt-3 pt-3 border-t border-stone-200">
        <button
          type="button"
          onClick={onReconcile}
          disabled={reconciling}
          className="rounded-xl bg-stone-100 text-stone-700 hover:bg-stone-200 px-4 py-2 text-sm font-semibold disabled:opacity-50 transition-colors"
        >
          {reconciling ? 'Reconciling…' : 'Reconcile'}
        </button>
        {errorMsg && (
          <p className="text-xs text-red-600 mt-2">{errorMsg}</p>
        )}
      </div>
    )
  }

  const matchedCount = lines.filter((l) => l.confidence !== 'unmatched').length
  const unmatchedCount = lines.length - matchedCount

  return (
    <div className="mt-3 rounded-2xl bg-stone-50 border border-stone-200 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h4 className="text-sm font-semibold text-stone-800">Reconciliation Results</h4>
        <div className="flex items-center gap-2">
          <ReconciliationPill status={status} />
          <button
            type="button"
            onClick={onReconcile}
            disabled={reconciling}
            className="text-xs text-[#8B2E4A] hover:text-[#72253C] font-medium disabled:opacity-50"
          >
            {reconciling ? '…' : 'Re-run'}
          </button>
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="text-xs text-stone-500">No per-line reconciliation needed.</p>
      ) : (
        <>
          <div className="hidden md:grid grid-cols-[1fr_6rem_6rem_8rem] gap-x-4 text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">
            <span>Resident</span>
            <span>Inv Date</span>
            <span>Log Date</span>
            <span>Status</span>
          </div>
          {lines.map((l, i) => (
            <div
              key={i}
              className="md:grid md:grid-cols-[1fr_6rem_6rem_8rem] md:gap-x-4 flex flex-col gap-0.5 py-1.5 text-sm border-t border-stone-100 first:border-t-0"
            >
              <span className="text-stone-700 truncate">{l.residentName}</span>
              <span className="text-stone-600 text-xs md:text-sm">
                {l.invoiceDate
                  ? new Date(`${l.invoiceDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '—'}
              </span>
              <span className="text-stone-600 text-xs md:text-sm">
                {l.logDate
                  ? new Date(`${l.logDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '—'}
              </span>
              <ReconciliationLineStatus line={l} />
            </div>
          ))}
        </>
      )}

      <div className="border-t border-stone-200 mt-3 pt-2 text-xs text-stone-500 flex flex-wrap items-center gap-x-2">
        {payment.reconciledAt && (
          <span>
            Reconciled{' '}
            {new Date(payment.reconciledAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              timeZone: facilityTimezone,
            })}
          </span>
        )}
        {payment.reconciledAt && lines.length > 0 && <span className="text-stone-300">·</span>}
        {lines.length > 0 && (
          <span>
            {matchedCount} matched
            {unmatchedCount > 0 ? `, ${unmatchedCount} flagged` : ''}
          </span>
        )}
      </div>

      {errorMsg && <p className="text-xs text-red-600 mt-2">{errorMsg}</p>}
    </div>
  )
}

function ReconciliationLineStatus({
  line,
}: {
  line: NonNullable<BillingPayment['reconciliationLines']>[number]
}) {
  if (line.confidence === 'high') {
    return (
      <span className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1">
        <span aria-hidden>✓</span>
        <span>Matched</span>
      </span>
    )
  }
  if (line.confidence === 'medium') {
    return (
      <span className="text-xs font-semibold text-amber-700 inline-flex items-center gap-1">
        <span aria-hidden>⚠</span>
        <span>{line.flagReason ?? 'Date off'}</span>
      </span>
    )
  }
  return (
    <span className="text-xs font-semibold text-red-700 inline-flex items-center gap-1">
      <span aria-hidden>✗</span>
      <span>{line.flagReason ?? 'No match'}</span>
    </span>
  )
}
