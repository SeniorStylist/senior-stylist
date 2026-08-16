// P55 — which days of the week does a REAL stylist actually work at this
// facility? Owners' call: a family "shouldn't even be able to ask for a
// Monday appointment if there's no stylist there." Drives the working-day
// hints/validation on the family request page and both staff sign-up forms.
// Pure DOW helpers live in src/lib/working-days.ts (client-safe).
//
// Deliberately UNCACHED: one cheap indexed query, and no availability-edit
// route busts any cache tag — a stale "closed Monday" would silently block
// real requests.
//
// Returns sorted distinct day_of_week values (0=Sun … 6=Sat). An EMPTY array
// means "no availability data" (brand-new facility, demo-only roster) —
// callers must treat empty as "allow anything", never as "closed all week".

import { db } from '@/db'
import { stylistAvailability, stylistFacilityAssignments, stylists } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

export async function getFacilityWorkingDows(facilityId: string): Promise<number[]> {
  try {
    const rows = await db
      .selectDistinct({ dow: stylistAvailability.dayOfWeek })
      .from(stylistAvailability)
      .innerJoin(
        stylists,
        and(
          eq(stylists.id, stylistAvailability.stylistId),
          eq(stylists.active, true),
          eq(stylists.status, 'active'),
          eq(stylists.isDemo, false),
        ),
      )
      .innerJoin(
        stylistFacilityAssignments,
        and(
          eq(stylistFacilityAssignments.stylistId, stylists.id),
          eq(stylistFacilityAssignments.facilityId, facilityId),
          eq(stylistFacilityAssignments.active, true),
        ),
      )
      .where(and(eq(stylistAvailability.facilityId, facilityId), eq(stylistAvailability.active, true)))

    return rows
      .map((r) => r.dow)
      .filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
      .sort((a, b) => a - b)
  } catch (err) {
    console.error('[facility-working-days] query failed:', err)
    return [] // fail open — empty = no restriction
  }
}
