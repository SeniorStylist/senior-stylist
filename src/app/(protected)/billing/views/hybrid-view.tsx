'use client'

import {
  BillingFacility,
  BillingInvoice,
  BillingPayment,
  BillingResident,
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
  const rfmsResidents = residents.filter((r) => r.residentPaymentType !== 'ip')

  const ipResidentIds = new Set(ipResidents.map((r) => r.id))
  const rfmsResidentIds = new Set(rfmsResidents.map((r) => r.id))

  const ipInvoices = invoices.filter(
    (i) => i.residentId && ipResidentIds.has(i.residentId)
  )
  const rfmsInvoices = invoices.filter(
    (i) => !i.residentId || rfmsResidentIds.has(i.residentId)
  )
  const rfmsPayments = payments.filter(
    (p) => !p.residentId || rfmsResidentIds.has(p.residentId)
  )

  return (
    <div className="space-y-4">
      <IPView
        facility={facility}
        residents={ipResidents}
        invoices={ipInvoices}
        onRefresh={onRefresh}
        title="IP Residents"
        defaultOpen={true}
      />
      <RFMSView
        facility={facility}
        residents={rfmsResidents}
        invoices={rfmsInvoices}
        payments={rfmsPayments}
        residentsTitle="RFMS Residents"
        checksTitle="RFMS Checks received"
        checksDefaultOpen={false}
        residentsDefaultOpen={false}
      />
    </div>
  )
}
