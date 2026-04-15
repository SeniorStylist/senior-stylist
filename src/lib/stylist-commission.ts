import type { StylistFacilityAssignment } from '@/types'

export function resolveCommission(
  stylistDefaultPercent: number,
  assignment: Pick<StylistFacilityAssignment, 'commissionPercent'> | null | undefined,
): number {
  if (assignment?.commissionPercent != null) return assignment.commissionPercent
  return stylistDefaultPercent
}
