export const NOT_FILLED = "Doesn't Fill"

export function formatServices(names: string[]): string {
  const clean = names.map((n) => n?.trim()).filter((n): n is string => !!n)
  if (clean.length === 0) return NOT_FILLED
  if (clean.length === 1) return clean[0]
  return clean.slice(0, -1).join(', ') + ' & ' + clean[clean.length - 1]
}

export function paymentTypeLabel(status: string | null | undefined): string {
  if (status === 'unpaid') return 'Invoice'
  if (status === 'paid' || status === 'waived') return 'Other'
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
