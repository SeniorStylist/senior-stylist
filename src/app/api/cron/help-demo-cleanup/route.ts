import { db } from '@/db'
import { facilities, facilityUsers, residents, stylists, services, bookings, logEntries, stylistCheckins, signupSheetEntries } from '@/db/schema'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Weekly cron: delete demo records inactive for 90+ days to prevent DB bloat
export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  try {
    const [r, s, sv, b, le, sc, ss] = await Promise.all([
      db.delete(residents).where(and(eq(residents.isDemo, true), eq(residents.active, false), lt(residents.createdAt, sql`${cutoff}::timestamptz`))).returning({ id: residents.id }),
      db.delete(stylists).where(and(eq(stylists.isDemo, true), eq(stylists.active, false), lt(stylists.createdAt, sql`${cutoff}::timestamptz`))).returning({ id: stylists.id }),
      db.delete(services).where(and(eq(services.isDemo, true), eq(services.active, false), lt(services.createdAt, sql`${cutoff}::timestamptz`))).returning({ id: services.id }),
      db.delete(bookings).where(and(eq(bookings.isDemo, true), eq(bookings.active, false), lt(bookings.createdAt, sql`${cutoff}::timestamptz`))).returning({ id: bookings.id }),
      db.delete(logEntries).where(and(eq(logEntries.isDemo, true), eq(logEntries.finalized, true), lt(logEntries.createdAt, sql`${cutoff}::timestamptz`))).returning({ id: logEntries.id }),
      db.delete(stylistCheckins).where(and(eq(stylistCheckins.isDemo, true), lt(stylistCheckins.createdAt, sql`${cutoff}::timestamptz`))).returning({ id: stylistCheckins.id }),
      db.delete(signupSheetEntries).where(and(eq(signupSheetEntries.isDemo, true), lt(signupSheetEntries.createdAt, sql`${cutoff}::timestamptz`))).returning({ id: signupSheetEntries.id }),
    ])

    // Demo facilities: delete facilityUsers FK first, then the facility rows
    const demoFacilities = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.isDemo, true), eq(facilities.active, false), lt(facilities.createdAt, sql`${cutoff}::timestamptz`)))
    let facilityCount = 0
    if (demoFacilities.length > 0) {
      const ids = demoFacilities.map((f) => f.id)
      await db.delete(facilityUsers).where(inArray(facilityUsers.facilityId, ids))
      const deleted = await db.delete(facilities).where(inArray(facilities.id, ids)).returning({ id: facilities.id })
      facilityCount = deleted.length
    }

    return Response.json({
      data: {
        deleted: {
          residents: r.length,
          stylists: s.length,
          services: sv.length,
          bookings: b.length,
          logEntries: le.length,
          checkins: sc.length,
          signupSheetEntries: ss.length,
          facilities: facilityCount,
        },
      },
    })
  } catch (err) {
    console.error('[help-demo-cleanup]', err)
    return Response.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
