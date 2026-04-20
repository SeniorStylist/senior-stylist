export interface BillingFacility {
  id: string
  name: string
  facilityCode: string | null
  paymentType: string
  qbOutstandingBalanceCents: number | null
  qbRevShareType: string | null
}

export interface BillingResident {
  id: string
  name: string
  roomNumber: string | null
  residentPaymentType: string | null
  qbOutstandingBalanceCents: number | null
  qbCustomerId: string | null
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
}

export interface BillingSummary {
  facility: BillingFacility
  residents: BillingResident[]
  invoices: BillingInvoice[]
  payments: BillingPayment[]
}

export function formatDollars(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`
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
