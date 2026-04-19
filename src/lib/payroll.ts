export interface NetPayInputs {
  payType: string
  commissionAmountCents: number
  hoursWorked: string | null
  hourlyRateCents: number | null
  flatAmountCents: number | null
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
  const totalDeductions = deductions.reduce((sum, d) => sum + d.amountCents, 0)
  return Math.max(0, base - totalDeductions)
}
