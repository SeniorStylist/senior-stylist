/**
 * Tip computation helpers (Phase 12E).
 *
 * Tips are stylist-only — never include them in facility revenue,
 * QB invoice totals, or rev-share splits. See CLAUDE.md.
 */

export type TipType = 'percentage' | 'fixed'

/**
 * Compute the tip amount in cents.
 * - 'percentage': tipValue is an integer percent (e.g. 15 = 15%)
 * - 'fixed': tipValue is already cents
 */
export function computeTipCents(
  priceCents: number,
  tipType: TipType,
  tipValue: number,
): number {
  if (!Number.isFinite(priceCents) || priceCents < 0) return 0
  if (!Number.isFinite(tipValue) || tipValue < 0) return 0
  if (tipType === 'percentage') return Math.round((priceCents * tipValue) / 100)
  return Math.round(tipValue)
}
