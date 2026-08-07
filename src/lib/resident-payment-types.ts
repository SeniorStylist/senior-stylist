// P51 — per-resident payer types (Josh's framework: "there will be a bunch of
// different payment types and those will calculate differently"). FRAMEWORK
// ONLY for now: the field is editable and visible, and billing shows a
// facility-vs-individual split — totals/exports/statement math is untouched
// until we "go deeper" (Josh, 2026-08-07).
//
// Values are chosen so the hybrid billing view's historical filter keeps
// working: anything starting with 'ip' is an INDIVIDUAL payer, everything
// else ('facility', 'credit', null) buckets with the facility/RFMS side.
// Client-safe module — no db imports.

export const RESIDENT_PAYMENT_TYPES = ['ip', 'ip_card', 'ip_cash', 'ip_check', 'facility', 'credit'] as const
export type ResidentPaymentType = (typeof RESIDENT_PAYMENT_TYPES)[number]

export const RESIDENT_PAYMENT_TYPE_LABELS: Record<ResidentPaymentType, string> = {
  ip: 'Individual payer',
  ip_card: 'Individual — card',
  ip_cash: 'Individual — cash',
  ip_check: 'Individual — check',
  facility: 'Facility-billed',
  credit: 'Salon credit',
}

/** Canonical individual-vs-facility split (null = facility side, matching the
 * hybrid view's historical behavior). */
export function isIndividualPayer(t: string | null | undefined): boolean {
  return !!t && t.startsWith('ip')
}

export function residentPaymentTypeLabel(t: string | null | undefined): string | null {
  if (!t) return null
  return (RESIDENT_PAYMENT_TYPE_LABELS as Record<string, string>)[t] ?? t
}
