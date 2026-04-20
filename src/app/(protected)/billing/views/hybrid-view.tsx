'use client'

import {
  BillingFacility,
  BillingInvoice,
  BillingPayment,
  BillingResident,
  StatCard,
  formatDollars,
} from './billing-shared'
import { IPView } from './ip-view'
import { RFMSView } from './rfms-view'

export function HybridView({
  facility,
  residents,
  invoices,
  payments,
  onRefresh,
}: {
  facility: BillingFacility
  residents: BillingResident[]
  invoices: BillingInvoice[]
  payments: BillingPayment[]
  onRefresh: () => void
}) {
  const ipResidents = residents.filter((r) => r.residentPaymentType === 'ip')
  const rfmsResidents = residents.filter(
    (r) => r.residentPaymentType !== 'ip'
  )

  const ipResidentIds = new Set(ipResidents.map((r) => r.id))
  const rfmsResidentIds = new Set(rfmsResidents.map((r) => r.id))

  const ipInvoices = invoices.filter((i) => i.residentId && ipResidentIds.has(i.residentId))
  const rfmsInvoices = invoices.filter(
    (i) => !i.residentId || rfmsResidentIds.has(i.residentId)
  )
  const rfmsPayments = payments.filter(
    (p) => !p.residentId || rfmsResidentIds.has(p.residentId)
  )

  const ipOutstanding = ipResidents.reduce(
    (s, r) => s + (r.qbOutstandingBalanceCents ?? 0),
    0
  )
  const rfmsOutstanding = rfmsResidents.reduce(
    (s, r) => s + (r.qbOutstandingBalanceCents ?? 0),
    0
  )

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-stone-900">IP Residents</h2>
          <div className="text-sm text-stone-500">
            Outstanding:{' '}
            <span
              className={
                ipOutstanding > 0
                  ? 'font-semibold text-amber-700'
                  : 'font-semibold text-stone-700'
              }
            >
              {formatDollars(ipOutstanding)}
            </span>
          </div>
        </div>
        <IPView facility={facility} residents={ipResidents} invoices={ipInvoices} onRefresh={onRefresh} />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-stone-900">RFMS Residents</h2>
          <div className="text-sm text-stone-500">
            Outstanding:{' '}
            <span
              className={
                rfmsOutstanding > 0
                  ? 'font-semibold text-amber-700'
                  : 'font-semibold text-stone-700'
              }
            >
              {formatDollars(rfmsOutstanding)}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <StatCard
            label="RFMS Residents"
            value={String(rfmsResidents.length)}
          />
          <StatCard
            label="Checks Recorded"
            value={String(rfmsPayments.length)}
          />
          <StatCard
            label="Outstanding"
            value={formatDollars(rfmsOutstanding)}
            highlight={rfmsOutstanding > 0 ? 'amber' : 'default'}
          />
        </div>
        <RFMSView
          facility={facility}
          residents={rfmsResidents}
          invoices={rfmsInvoices}
          payments={rfmsPayments}
        />
      </section>
    </div>
  )
}
