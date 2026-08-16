// Phase 25 — shared display formatters. formatDollars had five local
// re-implementations (payroll ×2, QB import client, family portal ×2) with
// subtly different output (some lacked thousands separators); this is the one
// canonical version. billing-shared.tsx re-exports it for existing importers.
//
// P54 — owner-locked money style (Fitzgerald meeting): customer-visible
// amounts show "110" / "48.50" / "1,234.56" — NO dollar sign, NO ".00" on
// whole-dollar amounts. formatMoney is the ONE implementation; formatDollars
// (here) and formatCents (utils.ts) are aliases so ~190 existing call sites
// pick it up without churn. KEEP raw $ / .toFixed(2): Excel numeric cells,
// CSV exports, QB/Stripe payloads, LLM prompts (OCR/memo-match), the refund
// audit memo stamp, and <input value> editing (needs a parseable "48.50").

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const CENTS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function formatMoney(cents: number | null | undefined): string {
  const c = cents ?? 0
  return c % 100 === 0 ? WHOLE.format(c / 100) : CENTS.format(c / 100)
}

export function formatDollars(cents: number): string {
  return formatMoney(cents)
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
