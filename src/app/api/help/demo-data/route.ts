import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { residents, stylists, services, bookings, logEntries as logEntriesTable, stylistCheckins } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

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
    db.update(residents)
      .set({ active: false })
      .where(and(eq(residents.facilityId, fid), eq(residents.isDemo, true))),
    db.update(stylists)
      .set({ active: false })
      .where(and(eq(stylists.facilityId, fid), eq(stylists.isDemo, true))),
    db.update(services)
      .set({ active: false })
      .where(and(eq(services.facilityId, fid), eq(services.isDemo, true))),
  ])

  return Response.json({ data: { ok: true } })
}
