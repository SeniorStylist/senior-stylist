import { db } from '@/db'
import { residents, stylists, services, stylistFacilityAssignments, stylistAvailability, bookings, facilities, qbInvoices, qbPayments, payPeriods, stylistPayItems } from '@/db/schema'
import { and, eq, gte, lt } from 'drizzle-orm'
import { dayRangeInTimezone, getLocalParts } from '@/lib/time'

// Deterministic demo character slugs used by the tour engine to look up IDs
export type DemoResidentSlug = 'mrs-smith' | 'mr-johnson'
export type DemoServiceSlug = 'wash-and-set' | 'haircut'
export type DemoStylistSlug = 'demo-sarah'
export type DemoPayPeriodSlug = 'demo-pay-period'

interface DemoIds {
  residents: Record<DemoResidentSlug, string>
  services: Record<DemoServiceSlug, string>
  stylists: Record<DemoStylistSlug, string>
  payPeriods: Record<DemoPayPeriodSlug, string>
}

// Seeder is idempotent — safe to call on every tutorial launch.
// viewerStylistId: when the tutorial user is a stylist, the today demo booking is
// assigned to THEM (not Demo Sarah) so it shows in their self-filtered daily log
// and dashboard list. Falls back to Demo Sarah for non-stylist viewers.
export async function seedFacilityDemoData(facilityId: string, viewerStylistId?: string | null): Promise<DemoIds> {
  const [existingResidents, existingServices, existingStylists] = await Promise.all([
    db.query.residents.findMany({
      where: and(eq(residents.facilityId, facilityId), eq(residents.isDemo, true)),
      columns: { id: true, name: true },
    }),
    db.query.services.findMany({
      where: and(eq(services.facilityId, facilityId), eq(services.isDemo, true)),
      columns: { id: true, name: true },
    }),
    db.query.stylists.findMany({
      where: and(eq(stylists.facilityId, facilityId), eq(stylists.isDemo, true)),
      columns: { id: true, name: true },
    }),
  ])

  // Build lookup maps from existing demo records
  const residentMap = new Map(existingResidents.map((r) => [r.name, r.id]))
  const serviceMap = new Map(existingServices.map((s) => [s.name, s.id]))
  const stylistMap = new Map(existingStylists.map((s) => [s.name, s.id]))

  // Seed Mrs. Margaret Smith
  if (!residentMap.has('Mrs. Margaret Smith')) {
    const [row] = await db
      .insert(residents)
      .values({
        facilityId,
        name: 'Mrs. Margaret Smith',
        roomNumber: '12',
        poaName: 'Robert Smith',
        poaEmail: 'demo-poa@example.com',
        notes: 'Tutorial demo resident — not a real person.',
        active: true,
        isDemo: true,
      })
      .onConflictDoNothing()
      .returning({ id: residents.id })
    if (row) residentMap.set('Mrs. Margaret Smith', row.id)
  }

  // Seed Mr. Robert Johnson
  if (!residentMap.has('Mr. Robert Johnson')) {
    const [row] = await db
      .insert(residents)
      .values({
        facilityId,
        name: 'Mr. Robert Johnson',
        roomNumber: '8',
        notes: 'Tutorial demo resident — not a real person.',
        active: true,
        isDemo: true,
      })
      .onConflictDoNothing()
      .returning({ id: residents.id })
    if (row) residentMap.set('Mr. Robert Johnson', row.id)
  }

  // Seed a near-duplicate of Mrs. Smith so the duplicate-resolution tour has a
  // real pair to merge. Same room + similar name → the detector flags it as a
  // "same room" duplicate. Re-run-safe: only (re)created when no ACTIVE demo
  // "Margaret Smith" exists, since a prior tour run may have merged it away
  // (merge soft-deletes the secondary record). Deliberately NOT tracked in
  // residentMap — it's never referenced by a {{slug}} placeholder.
  const dupName = 'Margaret Smith'
  const activeDup = await db.query.residents.findFirst({
    where: and(
      eq(residents.facilityId, facilityId),
      eq(residents.isDemo, true),
      eq(residents.active, true),
      eq(residents.name, dupName),
    ),
    columns: { id: true },
  })
  if (!activeDup) {
    await db
      .insert(residents)
      .values({
        facilityId,
        name: dupName,
        roomNumber: '12',
        notes: 'Tutorial demo resident — duplicate of Mrs. Margaret Smith.',
        active: true,
        isDemo: true,
      })
      .onConflictDoNothing()
  }

  // Seed Wash & Set service
  if (!serviceMap.has('Wash & Set (Demo)')) {
    const [row] = await db
      .insert(services)
      .values({
        facilityId,
        name: 'Wash & Set (Demo)',
        priceCents: 3500,
        durationMinutes: 45,
        pricingType: 'fixed',
        active: true,
        isDemo: true,
      })
      .onConflictDoNothing()
      .returning({ id: services.id })
    if (row) serviceMap.set('Wash & Set (Demo)', row.id)
  }

  // Seed Haircut service
  if (!serviceMap.has('Haircut (Demo)')) {
    const [row] = await db
      .insert(services)
      .values({
        facilityId,
        name: 'Haircut (Demo)',
        priceCents: 2500,
        durationMinutes: 30,
        pricingType: 'fixed',
        active: true,
        isDemo: true,
      })
      .onConflictDoNothing()
      .returning({ id: services.id })
    if (row) serviceMap.set('Haircut (Demo)', row.id)
  }

  // Seed Demo Sarah stylist
  if (!stylistMap.has('Demo Sarah')) {
    // Generate a unique stylist code
    const codeBase = 'ST900'
    const [row] = await db
      .insert(stylists)
      .values({
        facilityId,
        stylistCode: codeBase,
        name: 'Demo Sarah',
        color: '#8B2E4A',
        commissionPercent: 0,
        active: true,
        isDemo: true,
        status: 'active',
        specialties: [],
        phones: [],
      })
      .onConflictDoNothing()
      .returning({ id: stylists.id })
    if (row) {
      stylistMap.set('Demo Sarah', row.id)
      const stylistId = row.id

      // Assign to facility
      await db
        .insert(stylistFacilityAssignments)
        .values({ stylistId, facilityId, active: true })
        .onConflictDoNothing()

      // Add Mon–Fri availability (dayOfWeek 1=Mon … 5=Fri)
      for (let day = 1; day <= 5; day++) {
        await db
          .insert(stylistAvailability)
          .values({ stylistId, facilityId, dayOfWeek: day, startTime: '08:00', endTime: '17:00', active: true })
          .onConflictDoNothing()
      }
    }
  }

  // Seed a TODAY demo booking for Mrs. Smith so the daily-log + check-in tours
  // have a real row to act on (mark paid, finalize, check in). Idempotent: one
  // demo booking per facility per day for Mrs. Smith.
  const mrsSmithId = residentMap.get('Mrs. Margaret Smith')
  const sarahId = stylistMap.get('Demo Sarah')
  const washSetId = serviceMap.get('Wash & Set (Demo)')
  // Assign to the viewer when they're a stylist so it shows in their daily log.
  const bookingStylistId = viewerStylistId || sarahId
  if (mrsSmithId && bookingStylistId && washSetId) {
    const facRow = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { timezone: true },
    })
    const tz = facRow?.timezone ?? 'America/New_York'
    const p = getLocalParts(new Date(), tz)
    const todayStr = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
    const range = dayRangeInTimezone(todayStr, tz)
    if (range) {
      const existingToday = await db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facilityId),
          eq(bookings.residentId, mrsSmithId),
          eq(bookings.isDemo, true),
          gte(bookings.startTime, range.start),
          lt(bookings.startTime, range.end),
        ),
        columns: { id: true },
      })
      if (existingToday.length === 0) {
        // 10:00 local — range.start is local midnight expressed as a UTC instant.
        const startTime = new Date(range.start.getTime() + 10 * 60 * 60 * 1000)
        const endTime = new Date(startTime.getTime() + 45 * 60 * 1000)
        await db.insert(bookings).values({
          facilityId,
          residentId: mrsSmithId,
          stylistId: bookingStylistId,
          serviceId: washSetId,
          serviceIds: [washSetId],
          serviceNames: ['Wash & Set (Demo)'],
          startTime,
          endTime,
          durationMinutes: 45,
          totalDurationMinutes: 45,
          priceCents: 3500,
          status: 'scheduled',
          isDemo: true,
        }).onConflictDoNothing()
      }
    }
  }

  // Seed demo BILLING + PAYROLL so the bookkeeper billing/payroll/QuickBooks
  // tutorials show populated screens. All rows carry is_demo=true and are read
  // back only while the tutorial cookie is set, so they never touch real money.
  // Idempotent — keyed off existing demo rows for this facility.
  const nowDate = new Date()
  const todayDateStr = nowDate.toISOString().split('T')[0]
  const monthStartStr = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}-01`

  let demoPayPeriodId = ''
  if (mrsSmithId) {
    // Demo invoice — an open balance for Mrs. Smith.
    const existingInvoice = await db.query.qbInvoices.findFirst({
      where: and(eq(qbInvoices.facilityId, facilityId), eq(qbInvoices.isDemo, true)),
      columns: { id: true },
    })
    if (!existingInvoice) {
      await db
        .insert(qbInvoices)
        .values({
          facilityId,
          residentId: mrsSmithId,
          invoiceNum: 'DEMO-INV-1',
          invoiceDate: todayDateStr,
          amountCents: 3500,
          openBalanceCents: 3500,
          status: 'open',
          isDemo: true,
        })
        .onConflictDoNothing()
    }
    // Reflect the open balance on the resident so the per-resident billing list
    // shows it too (real residents are untouched — this is a demo row).
    await db
      .update(residents)
      .set({ qbOutstandingBalanceCents: 3500 })
      .where(and(eq(residents.id, mrsSmithId), eq(residents.isDemo, true)))

    // Demo payment — a check already received from Mrs. Smith.
    const existingPayment = await db.query.qbPayments.findFirst({
      where: and(eq(qbPayments.facilityId, facilityId), eq(qbPayments.isDemo, true)),
      columns: { id: true },
    })
    if (!existingPayment) {
      await db
        .insert(qbPayments)
        .values({
          facilityId,
          residentId: mrsSmithId,
          checkNum: '1042',
          checkDate: todayDateStr,
          paymentDate: todayDateStr,
          amountCents: 2500,
          memo: 'Tutorial demo payment',
          paymentMethod: 'check',
          recordedVia: 'manual',
          isDemo: true,
        })
        .onConflictDoNothing()
    }
  }

  if (sarahId) {
    // Demo pay period + one pay item for Demo Sarah so the payroll tutorial has a
    // real period to open, review, and (optionally) mark paid.
    const existingPeriod = await db.query.payPeriods.findFirst({
      where: and(eq(payPeriods.facilityId, facilityId), eq(payPeriods.isDemo, true)),
      columns: { id: true },
    })
    if (existingPeriod) {
      demoPayPeriodId = existingPeriod.id
    } else {
      const [periodRow] = await db
        .insert(payPeriods)
        .values({
          facilityId,
          periodType: 'monthly',
          startDate: monthStartStr,
          endDate: todayDateStr,
          status: 'open',
          notes: 'Tutorial demo pay period',
          isDemo: true,
        })
        .returning({ id: payPeriods.id })
      if (periodRow) {
        demoPayPeriodId = periodRow.id
        // 50% commission on $35 gross → $17.50 net.
        await db
          .insert(stylistPayItems)
          .values({
            payPeriodId: periodRow.id,
            stylistId: sarahId,
            facilityId,
            payType: 'commission',
            grossRevenueCents: 3500,
            commissionRate: 50,
            commissionAmountCents: 1750,
            netPayCents: 1750,
            isDemo: true,
          })
          .onConflictDoNothing()
      }
    }
  }

  return {
    residents: {
      'mrs-smith': residentMap.get('Mrs. Margaret Smith') ?? '',
      'mr-johnson': residentMap.get('Mr. Robert Johnson') ?? '',
    },
    services: {
      'wash-and-set': serviceMap.get('Wash & Set (Demo)') ?? '',
      haircut: serviceMap.get('Haircut (Demo)') ?? '',
    },
    stylists: {
      'demo-sarah': stylistMap.get('Demo Sarah') ?? '',
    },
    payPeriods: {
      'demo-pay-period': demoPayPeriodId,
    },
  }
}

