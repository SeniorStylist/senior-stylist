// Shared payment-type model for the daily-log / OCR-scan flows.
//
// A booking's payment is stored as (paymentStatus, paymentMethod):
//   - paymentStatus drives BILLING (unpaid = still owed / open invoice, paid =
//     collected, waived = not owed).
//   - paymentMethod is the free-text label shown in the Excel export's
//     "Payment Type" column (Cash / Check / Card / ACH / RFMS / COF / RA / …).
//
// Decision (Josh, 2026-06-26): only Cash/Check/Card/ACH count as COLLECTED.
// RFMS / COF / RA (and any custom label) are billing channels that stay an OPEN
// INVOICE — paymentStatus = 'unpaid' so they remain in the facility's
// outstanding balance, but the export shows their literal label.

export type PaymentStatus = 'unpaid' | 'paid' | 'waived'

// The dropdown options shown in the OCR review modal + daily-log edit form.
// "Unpaid (Invoice)" and "Waived" are special status-only labels; the rest are
// method labels. A "➕ Custom…" escape hatch lets bookkeepers add their own.
export const PAYMENT_TYPE_OPTIONS = [
  'Unpaid (Invoice)',
  'Cash',
  'Check',
  'Card',
  'ACH',
  'RFMS',
  'COF',
  'RA',
  'Waived',
] as const

// Methods that mean the money was actually collected → paymentStatus 'paid'.
const COLLECTED_METHODS = new Set(['cash', 'check', 'card', 'ach'])

// Parse a dropdown/typed label into the stored (status, method) pair.
export function parsePaymentCombo(label: string): {
  paymentStatus: PaymentStatus
  paymentMethod: string | null
} {
  const raw = label.trim()
  const v = raw.toLowerCase()
  if (!v || v === 'unpaid (invoice)' || v === 'unpaid' || v === 'invoice') {
    return { paymentStatus: 'unpaid', paymentMethod: null }
  }
  if (v === 'waived') return { paymentStatus: 'waived', paymentMethod: null }
  if (COLLECTED_METHODS.has(v)) {
    return { paymentStatus: 'paid', paymentMethod: raw }
  }
  // RFMS / COF / RA / anything custom → open invoice carrying a display label.
  return { paymentStatus: 'unpaid', paymentMethod: raw }
}

// Seed a select/edit field from an existing booking's stored values. The method
// label wins (so an unpaid "RFMS" booking shows "RFMS", not "Unpaid (Invoice)").
export function comboLabel(
  paymentStatus: string,
  paymentMethod: string | null | undefined
): string {
  const m = paymentMethod?.trim()
  if (m) return m
  if (paymentStatus === 'waived') return 'Waived'
  if (paymentStatus === 'paid') return 'Paid'
  return 'Unpaid (Invoice)'
}
