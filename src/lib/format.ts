// Phase 25 — shared display formatters. formatDollars had five local
// re-implementations (payroll ×2, QB import client, family portal ×2) with
// subtly different output (some lacked thousands separators); this is the one
// canonical version. billing-shared.tsx re-exports it for existing importers.

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

export function formatDollars(cents: number): string {
  return USD.format((cents ?? 0) / 100)
}

import { formatDateInTz } from '@/lib/time'

/**
 * Short date chip for a plain YYYY-MM-DD string, rendered in the facility's
 * timezone. Anchored at noon UTC of that date so the tz conversion can't
 * shift the weekday. (Was duplicated in signup-sheet-panel and
 * stylist-pending-entries.)
 */
export function formatDateChip(yyyymmdd: string, tz: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  if (!y || !m || !d) return yyyymmdd
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return formatDateInTz(anchor, tz)
}
