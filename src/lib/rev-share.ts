export type RevShareType = 'we_deduct' | 'facility_deducts'

export interface RevShareResult {
  totalCents: number
  seniorStylistCents: number
  facilityShareCents: number
  revShareType: RevShareType | null
  revSharePercentage: number
}

export function calculateRevShare(
  totalCents: number,
  revSharePercentage: number | null,
  revShareType: RevShareType | string | null,
): RevShareResult {
  if (!revSharePercentage || revSharePercentage <= 0 || !revShareType) {
    return {
      totalCents,
      seniorStylistCents: totalCents,
      facilityShareCents: 0,
      revShareType: null,
      revSharePercentage: 0,
    }
  }
  const facilityShareCents = Math.round((totalCents * revSharePercentage) / 100)
  const seniorStylistCents = totalCents - facilityShareCents
  return {
    totalCents,
    seniorStylistCents,
    facilityShareCents,
    revShareType: revShareType as RevShareType,
    revSharePercentage,
  }
}
