export interface NetPayInputs {
  payType: string
  commissionAmountCents: number
  hoursWorked: string | null
  hourlyRateCents: number | null
  flatAmountCents: number | null
  // Phase 12E: tips are additive to base pay; deductions apply to the combined total.
  // Treated as 0 when undefined so callers that haven't migrated still compute correctly.
  tipCentsTotal?: number | null
}

export function computeNetPay(
  item: NetPayInputs,
  deductions: { amountCents: number }[],
): number {
  const base =
    item.payType === 'commission'
      ? item.commissionAmountCents
      : item.payType === 'hourly'
        ? Math.round(parseFloat(item.hoursWorked ?? '0') * (item.hourlyRateCents ?? 0))
        : (item.flatAmountCents ?? 0)
  const tips = item.tipCentsTotal ?? 0
  const totalDeductions = deductions.reduce((sum, d) => sum + d.amountCents, 0)
  return Math.max(0, base + tips - totalDeductions)
}
