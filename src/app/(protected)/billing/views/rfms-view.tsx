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

export function RFMSView({
  residents,
  invoices,
  payments,
  residentsTitle = 'Residents',
  checksTitle = 'Checks received',
  checksDefaultOpen = false,
  residentsDefaultOpen = false,
}: {
  facility: BillingFacility
  residents: BillingResident[]
  invoices: BillingInvoice[]
  payments: BillingPayment[]
  residentsTitle?: string
  checksTitle?: string
  checksDefaultOpen?: boolean
  residentsDefaultOpen?: boolean
}) {
  const [expandedCheckId, setExpandedCheckId] = useState<string | null>(null)

  function getRemittanceLines(p: BillingPayment): RemittanceLine[] | null {
    const bd = p.residentBreakdown
    if (bd && !Array.isArray(bd) && (bd as { type?: string }).type === 'remittance_lines') {
      return (bd as { type: string; lines: RemittanceLine[] }).lines
    }
    return null
  }

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
        {payments.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-stone-500">
            No checks recorded for this facility yet.
          </div>
        ) : (
          <>
            <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-100 bg-stone-50">
              <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Date
              </div>
              <div className="col-span-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Check #
              </div>
              <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide text-right">
                Amount
              </div>
              <div className="col-span-5 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Memo / Invoice Ref
              </div>
            </div>
            {(() => {
              let lastYear: number | null = null
              return payments.map((p) => {
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
                      <div className="md:col-span-5 text-sm text-stone-500 truncate">
                        {p.memo ?? p.invoiceRef ?? (
                          <span className="text-stone-400">—</span>
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
            <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-100 bg-stone-50">
              <div className="col-span-4 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Resident
              </div>
              <div className="col-span-1 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Room
              </div>
              <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">
                Last Service
              </div>
              <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide text-right">
                Billed
              </div>
              <div className="col-span-3 text-xs font-semibold text-stone-500 uppercase tracking-wide text-right">
                Outstanding
              </div>
            </div>
            {residents.map((r) => {
              const t = computeResidentTotals(r, invoices)
              const outstandingClass =
                t.outstandingCents > 0
                  ? 'text-sm font-semibold text-amber-700 md:text-right'
                  : 'text-sm text-stone-500 md:text-right'
              return (
                <div
                  key={r.id}
                  className="md:grid md:grid-cols-12 md:gap-4 md:items-center flex flex-col gap-1.5 px-5 py-3 border-b border-stone-50 last:border-0"
                >
                  <div className="md:col-span-4 text-sm font-medium text-stone-900">
                    {r.name}
                  </div>
                  <div className="md:col-span-1 text-sm text-stone-500">
                    {r.roomNumber ?? '—'}
                  </div>
                  <div className="md:col-span-2 text-sm text-stone-500">
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
