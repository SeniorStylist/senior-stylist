'use client'

import {
  BillingInvoice,
  BillingResident,
  DisabledActionButton,
  computeResidentTotals,
  formatDollars,
  formatInvoiceDate,
  formatSentVia,
  formatShortDate,
} from './billing-shared'

export function IPView({
  residents,
  invoices,
}: {
  residents: BillingResident[]
  invoices: BillingInvoice[]
}) {
  if (residents.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-10 text-center">
        <p className="text-sm text-stone-500">No residents set up for this facility yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
      <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-2.5 border-b border-stone-100 bg-stone-50">
        <div className="col-span-3 text-xs font-semibold text-stone-500 uppercase tracking-wide">
          Resident
        </div>
        <div className="col-span-1 text-xs font-semibold text-stone-500 uppercase tracking-wide">
          Room
        </div>
        <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">
          Last Service
        </div>
        <div className="col-span-1 text-xs font-semibold text-stone-500 uppercase tracking-wide text-right">
          Billed
        </div>
        <div className="col-span-1 text-xs font-semibold text-stone-500 uppercase tracking-wide text-right">
          Paid
        </div>
        <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide text-right">
          Outstanding
        </div>
        <div className="col-span-2 text-xs font-semibold text-stone-500 uppercase tracking-wide text-right">
          Last Sent
        </div>
      </div>

      {residents.map((r) => {
        const t = computeResidentTotals(r, invoices)
        const outstandingClass =
          t.outstandingCents > 0
            ? 'text-sm font-semibold text-amber-700 text-right'
            : 'text-sm text-stone-500 text-right'
        return (
          <div
            key={r.id}
            className="md:grid md:grid-cols-12 md:gap-4 md:items-center flex flex-col gap-1.5 px-5 py-3.5 border-b border-stone-50 last:border-0"
          >
            <div className="md:col-span-3 text-sm font-medium text-stone-900">{r.name}</div>
            <div className="md:col-span-1 text-sm text-stone-500">{r.roomNumber ?? '—'}</div>
            <div className="md:col-span-2 text-sm text-stone-500">
              {formatInvoiceDate(t.lastServiceDate)}
            </div>
            <div className="md:col-span-1 text-sm font-semibold text-stone-700 md:text-right">
              {formatDollars(t.billedCents)}
            </div>
            <div className="md:col-span-1 text-sm text-stone-600 md:text-right">
              {formatDollars(t.paidCents)}
            </div>
            <div className={outstandingClass}>{formatDollars(t.outstandingCents)}</div>
            <div className="md:col-span-2 md:text-right flex md:justify-end items-center gap-2">
              <div className="text-xs text-stone-500">
                {t.lastSentAt ? (
                  <>
                    {formatShortDate(t.lastSentAt.slice(0, 10))}{' '}
                    <span className="text-stone-400">· {formatSentVia(t.lastSentVia)}</span>
                  </>
                ) : (
                  <span className="text-stone-400">— never</span>
                )}
              </div>
              <DisabledActionButton label="Send" title="Available in Phase 11C" />
            </div>
          </div>
        )
      })}
    </div>
  )
}
