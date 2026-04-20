export interface BillingFacility {
  id: string
  name: string
  facilityCode: string | null
  paymentType: string
  qbOutstandingBalanceCents: number | null
  qbRevShareType: string | null
  contactEmail: string | null
  address: string | null
}

export interface BillingResident {
  id: string
  name: string
  roomNumber: string | null
  residentPaymentType: string | null
  qbOutstandingBalanceCents: number | null
  qbCustomerId: string | null
  poaEmail: string | null
}

export interface BillingInvoice {
  id: string
  facilityId: string
  residentId: string | null
  qbCustomerId: string | null
  invoiceNum: string
  invoiceDate: string
  dueDate: string | null
  amountCents: number
  openBalanceCents: number
  status: string
  paymentType: string | null
  qbInvoiceId: string | null
  lastSentAt: string | null
  sentVia: string | null
}

export type RemittanceLine = {
  ref: string | null
  invoiceDate: string | null
  amountCents: number
}

export interface BillingPayment {
  id: string
  facilityId: string
  residentId: string | null
  qbCustomerId: string | null
  checkNum: string | null
  checkDate: string | null
  paymentDate: string
  amountCents: number
  memo: string | null
  invoiceRef: string | null
  paymentType: string | null
  recordedVia: string
  residentBreakdown?:
    | Array<{
        name: string
        residentId: string | null
        amountCents: number
        matchConfidence: string
      }>
    | { type: 'remittance_lines'; lines: RemittanceLine[] }
    | null
}

export interface BillingSummary {
  facility: BillingFacility
  residents: BillingResident[]
  invoices: BillingInvoice[]
  payments: BillingPayment[]
}

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatDollars(cents: number): string {
  return USD.format((cents ?? 0) / 100)
}

export function revShareLabel(type: string | null | undefined): string {
  if (type === 'facility_deducts') return 'Facility deducts revenue share before paying'
  return 'Senior Stylist deducts revenue share'
}

export function formatInvoiceDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatSentVia(sentVia: string | null | undefined): string {
  if (sentVia === 'quickbooks') return 'via QB'
  if (sentVia === 'resend' || sentVia === 'email') return 'via email'
  return sentVia ?? ''
}

export function SendDedupModal({
  lastSentAt,
  onConfirm,
  onCancel,
}: {
  lastSentAt: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const d = new Date(lastSentAt)
  const dateLabel = Number.isNaN(d.getTime())
    ? lastSentAt
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        <h3 className="text-base font-semibold text-stone-900 mb-2">Already sent recently</h3>
        <p className="text-sm text-stone-600 mb-5">
          A statement was last sent on <strong>{dateLabel}</strong>. Send again?
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border border-stone-200 text-sm text-stone-700 hover:bg-stone-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl bg-[#8B2E4A] text-white text-sm font-semibold hover:bg-[#72253C]"
          >
            Send Anyway
          </button>
        </div>
      </div>
    </div>
  )
}

export function DisabledActionButton({
  label,
  title,
}: {
  label: string
  title: string
}) {
  return (
    <button
      type="button"
      disabled
      title={title}
      className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold bg-[#8B2E4A] text-white opacity-40 cursor-not-allowed"
    >
      {label}
    </button>
  )
}

export function StatCard({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: 'amber' | 'default'
}) {
  const container =
    highlight === 'amber'
      ? 'bg-amber-50 rounded-xl px-4 py-3'
      : 'bg-stone-50 rounded-xl px-4 py-3'
  const valueClass =
    highlight === 'amber'
      ? 'text-xl font-bold text-amber-700'
      : 'text-xl font-bold text-stone-900'
  return (
    <div className={container}>
      <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className={valueClass}>{value}</div>
    </div>
  )
}

export interface ResidentTotals {
  billedCents: number
  paidCents: number
  outstandingCents: number
  lastServiceDate: string | null
  lastSentAt: string | null
  lastSentVia: string | null
}

export function computeResidentTotals(
  resident: BillingResident,
  invoices: BillingInvoice[]
): ResidentTotals {
  const mine = invoices.filter((i) => i.residentId === resident.id)
  const billed = mine.reduce((s, i) => s + (i.amountCents ?? 0), 0)
  const outstanding = resident.qbOutstandingBalanceCents ?? 0
  const paid = billed - outstanding
  let lastServiceDate: string | null = null
  let lastSentAt: string | null = null
  let lastSentVia: string | null = null
  for (const i of mine) {
    if (!lastServiceDate || i.invoiceDate > lastServiceDate) lastServiceDate = i.invoiceDate
    if (i.lastSentAt) {
      if (!lastSentAt || i.lastSentAt > lastSentAt) {
        lastSentAt = i.lastSentAt
        lastSentVia = i.sentVia
      }
    }
  }
  return {
    billedCents: billed,
    paidCents: paid,
    outstandingCents: outstanding,
    lastServiceDate,
    lastSentAt,
    lastSentVia,
  }
}
