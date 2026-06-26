export const NOT_FILLED = "Doesn't Fill"

export function formatServices(names: string[]): string {
  const clean = names.map((n) => n?.trim()).filter((n): n is string => !!n)
  if (clean.length === 0) return NOT_FILLED
  if (clean.length === 1) return clean[0]
  return clean.slice(0, -1).join(', ') + ' & ' + clean[clean.length - 1]
}

// Payment Type column. The free-text `method` (Cash/Check/Card/ACH/RFMS/COF/RA/
// custom) is the bookkeeper's chosen label and wins when present; otherwise fall
// back to the status. RFMS/COF/RA are stored unpaid (open invoice) but still
// carry a method, so they export as their literal label — not "Invoice".
export function paymentTypeLabel(
  status: string | null | undefined,
  method?: string | null
): string {
  const m = method?.trim()
  if (m) return m
  if (status === 'unpaid') return 'Invoice'
  if (status === 'waived') return 'Waived'
  if (status === 'paid') return 'Other'
  return NOT_FILLED
}

export function dollarsNumber(cents: number | null | undefined): number {
  return (cents ?? 0) / 100
}

export function tipsCell(tipCents: number | null | undefined): number | string {
  if (tipCents == null || tipCents === 0) return NOT_FILLED
  return tipCents / 100
}

export function facilityLabel(code: string | null | undefined, name: string): string {
  return code ? `${code} - ${name}` : name
}

export function stylistLabel(code: string, name: string): string {
  return `${code} - ${name}`
}

export function notesCell(notes: string | null | undefined): string {
  const trimmed = notes?.trim()
  return trimmed ? trimmed : NOT_FILLED
}

export function roomCell(roomNumber: string | null | undefined): string {
  const trimmed = roomNumber?.trim()
  return trimmed ? trimmed : NOT_FILLED
}
