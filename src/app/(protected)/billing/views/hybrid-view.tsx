'use client'

import {
  BillingFacility,
  BillingInvoice,
  BillingPayment,
  BillingResident,
} from './billing-shared'
import { IPView } from './ip-view'
import { RFMSView } from './rfms-view'
import { isIndividualPayer } from '@/lib/resident-payment-types'

export function HybridView({
  facility,
  residents,
  invoices,
  payments,
  onRefresh,
  onPaymentUpdated,
}: {
  facility: BillingFacility
  residents: BillingResident[]
  invoices: BillingInvoice[]
  payments: BillingPayment[]
  onRefresh: () => void
  onPaymentUpdated?: (payment: BillingPayment) => void
}) {
  // P51 — any 'ip*' payer type counts as individual (ip, ip_card, ip_cash,
  // ip_check); null/facility/credit stay on the RFMS side, as always.
  const ipResidents = residents.filter((r) => isIndividualPayer(r.residentPaymentType))
  const rfmsResidents = residents.filter((r) => !isIndividualPayer(r.residentPaymentType))

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
        onPaymentUpdated={onPaymentUpdated}
      />
    </div>
  )
}
