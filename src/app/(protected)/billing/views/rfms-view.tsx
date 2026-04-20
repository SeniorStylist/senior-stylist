'use client'

import {
  BillingFacility,
  BillingInvoice,
  BillingPayment,
  BillingResident,
  DisabledActionButton,
  computeResidentTotals,
  formatDollars,
  formatInvoiceDate,
  formatShortDate,
  revShareLabel,
} from './billing-shared'

export function RFMSView({
  facility,
  residents,
  invoices,
  payments,
}: {
  facility: BillingFacility
  residents: BillingResident[]
  invoices: BillingInvoice[]
  payments: BillingPayment[]
}) {
  return (
    <div className="space-y-6">
      <div className="bg-rose-50 border border-rose-100 text-rose-900 px-4 py-3 rounded-2xl text-sm">
        <span className="font-semibold">Revenue share:</span>{' '}
        {revShareLabel(facility.qbRevShareType)}
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100">
          <h3 className="text-sm font-semibold text-stone-700">Checks received</h3>
          <DisabledActionButton
            label="Send via QB"
            title="Available after QB production approval"
          />
        </div>

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
            {payments.map((p) => (
              <div
                key={p.id}
                className="md:grid md:grid-cols-12 md:gap-4 md:items-center flex flex-col gap-1 px-5 py-3 border-b border-stone-50 last:border-0"
              >
                <div className="md:col-span-2 text-sm text-stone-700">
                  {formatInvoiceDate(p.paymentDate)}
                </div>
                <div className="md:col-span-3 text-sm text-stone-900 font-medium">
                  {p.checkNum ?? <span className="text-stone-400">—</span>}
                </div>
                <div className="md:col-span-2 text-sm font-semibold text-stone-900 md:text-right">
                  {formatDollars(p.amountCents)}
                </div>
                <div className="md:col-span-5 text-sm text-stone-500 truncate">
                  {p.memo ?? p.invoiceRef ?? <span className="text-stone-400">—</span>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-100">
          <h3 className="text-sm font-semibold text-stone-700">Per-resident breakdown</h3>
        </div>
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
                  <div className="md:col-span-4 text-sm font-medium text-stone-900">{r.name}</div>
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
      </div>
    </div>
  )
}
