import { db } from '@/db'
import { facilities, facilityUsers, residents, stylists, services, bookings, logEntries, stylistCheckins, signupSheetEntries, qbInvoices, qbPayments, payPeriods } from '@/db/schema'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Daily cron: hard-delete throwaway tutorial demo data.
//
// A scripted tutorial seeds is_demo=true records (and the master "add facility"
// tour creates an is_demo=true facility like "Sunrise of Denver"). A clean exit
// soft-deletes them, but if the user abandons the tour mid-way (closes the tab)
// nothing ever cleans them up — they linger as is_demo=true, active=true forever
// and leak into any view that forgets the is_demo filter.
//
// A real tutorial session is bounded by the 15-minute tutorial cookie, so ANY
// is_demo row older than the cutoff is abandoned and safe to remove — regardless
// of its `active` flag. Re-seeding happens automatically on the next launch.
//
// Deletion MUST follow FK order: bookings reference residents/stylists/services
// with ON DELETE RESTRICT, and residents.default_service_id references services
// with RESTRICT. So: bookings + period/log children first, then residents, then
// stylists, then services, then the facilities themselves. (The previous version
// deleted these in parallel and FK-violated whenever demo bookings existed, which
// silently 500'd the whole cron — the root cause of accumulated leftovers.)
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const cutoffTs = sql`${cutoff}::timestamptz`

  try {
    // 1. bookings — RESTRICT refs to residents/stylists/services/facilities.
    const b = await db.delete(bookings)
      .where(and(eq(bookings.isDemo, true), lt(bookings.createdAt, cutoffTs)))
      .returning({ id: bookings.id })

    // 2. pay periods — cascades stylist_pay_items (which RESTRICT-ref stylists),
    //    so the period must go before the stylists below.
    const pp = await db.delete(payPeriods)
      .where(and(eq(payPeriods.isDemo, true), lt(payPeriods.createdAt, cutoffTs)))
      .returning({ id: payPeriods.id })

    // 3. facility-cascade / set-null children — don't block resident/stylist
    //    deletes, but remove them explicitly so nothing demo survives.
    const [le, sc, ss, inv, pay] = await Promise.all([
      db.delete(logEntries).where(and(eq(logEntries.isDemo, true), lt(logEntries.createdAt, cutoffTs))).returning({ id: logEntries.id }),
      db.delete(stylistCheckins).where(and(eq(stylistCheckins.isDemo, true), lt(stylistCheckins.createdAt, cutoffTs))).returning({ id: stylistCheckins.id }),
      db.delete(signupSheetEntries).where(and(eq(signupSheetEntries.isDemo, true), lt(signupSheetEntries.createdAt, cutoffTs))).returning({ id: signupSheetEntries.id }),
      db.delete(qbInvoices).where(and(eq(qbInvoices.isDemo, true), lt(qbInvoices.createdAt, cutoffTs))).returning({ id: qbInvoices.id }),
      db.delete(qbPayments).where(and(eq(qbPayments.isDemo, true), lt(qbPayments.createdAt, cutoffTs))).returning({ id: qbPayments.id }),
    ])

    // 4. residents — after bookings (RESTRICT) are gone.
    const r = await db.delete(residents)
      .where(and(eq(residents.isDemo, true), lt(residents.createdAt, cutoffTs)))
      .returning({ id: residents.id })

    // 5. stylists — cascades stylist_facility_assignments / notes / availability.
    const s = await db.delete(stylists)
      .where(and(eq(stylists.isDemo, true), lt(stylists.createdAt, cutoffTs)))
      .returning({ id: stylists.id })

    // 6. services — after residents (default_service_id RESTRICT) and bookings.
    const sv = await db.delete(services)
      .where(and(eq(services.isDemo, true), lt(services.createdAt, cutoffTs)))
      .returning({ id: services.id })

    // 7. demo facilities (e.g. "Sunrise of Denver") — delete facility_users FK first.
    const demoFacilities = await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.isDemo, true), lt(facilities.createdAt, cutoffTs)))
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
          qbInvoices: inv.length,
          qbPayments: pay.length,
          payPeriods: pp.length,
          facilities: facilityCount,
        },
      },
    })
  } catch (err) {
    console.error('[help-demo-cleanup]', err)
    return Response.json({ error: 'Cleanup failed' }, { status: 500 })
  }
}
