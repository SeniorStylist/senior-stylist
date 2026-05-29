import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { facilities, facilityUsers, residents, stylists, services, bookings, logEntries as logEntriesTable, stylistCheckins, signupSheetEntries } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'

// Admin-only: soft-delete all is_demo=true records for the facility.
// Re-seeding happens automatically on the next tutorial launch.
export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 404 })
  if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

  const fid = facilityUser.facilityId

  // Soft-delete demo facilities owned by this user (master admin tours create them)
  const demoFacilityRows = await db
    .select({ facilityId: facilityUsers.facilityId })
    .from(facilityUsers)
    .innerJoin(facilities, eq(facilities.id, facilityUsers.facilityId))
    .where(and(eq(facilityUsers.userId, facilityUser.userId), eq(facilities.isDemo, true)))
  const demoFacilityIds = demoFacilityRows.map((r) => r.facilityId)

  await Promise.all([
    db.update(bookings)
      .set({ active: false })
      .where(and(eq(bookings.facilityId, fid), eq(bookings.isDemo, true))),
    // logEntries has no active column — hard-delete demo entries (same as cron cleanup)
    db.delete(logEntriesTable)
      .where(and(eq(logEntriesTable.facilityId, fid), eq(logEntriesTable.isDemo, true))),
    // stylistCheckins has no active column — hard-delete (same as cron cleanup)
    db.delete(stylistCheckins)
      .where(and(eq(stylistCheckins.facilityId, fid), eq(stylistCheckins.isDemo, true))),
    // signupSheetEntries has no active column — hard-delete demo entries
    db.delete(signupSheetEntries)
      .where(and(eq(signupSheetEntries.facilityId, fid), eq(signupSheetEntries.isDemo, true))),
    db.update(residents)
      .set({ active: false })
      .where(and(eq(residents.facilityId, fid), eq(residents.isDemo, true))),
    db.update(stylists)
      .set({ active: false })
      .where(and(eq(stylists.facilityId, fid), eq(stylists.isDemo, true))),
    db.update(services)
      .set({ active: false })
      .where(and(eq(services.facilityId, fid), eq(services.isDemo, true))),
    // Soft-delete demo facilities the user owns (is_demo=true facilities created during tours)
    ...(demoFacilityIds.length > 0
      ? [db.update(facilities).set({ active: false }).where(inArray(facilities.id, demoFacilityIds))]
      : []),
  ])

  return Response.json({ data: { ok: true } })
}
