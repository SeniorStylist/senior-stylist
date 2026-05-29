import { db } from '@/db'
import { residents, stylists, services, stylistFacilityAssignments, stylistAvailability } from '@/db/schema'
import { and, eq } from 'drizzle-orm'

// Deterministic demo character slugs used by the tour engine to look up IDs
export type DemoResidentSlug = 'mrs-smith' | 'mr-johnson'
export type DemoServiceSlug = 'wash-and-set' | 'haircut'
export type DemoStylistSlug = 'demo-sarah'

interface DemoIds {
  residents: Record<DemoResidentSlug, string>
  services: Record<DemoServiceSlug, string>
  stylists: Record<DemoStylistSlug, string>
}

// Seeder is idempotent — safe to call on every tutorial launch
export async function seedFacilityDemoData(facilityId: string): Promise<DemoIds> {
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
  }
}

// Convenience getters for the tour engine
export async function getDemoIds(facilityId: string): Promise<DemoIds | null> {
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

  if (!existingResidents.length) return null

  const rMap = new Map(existingResidents.map((r) => [r.name, r.id]))
  const sMap = new Map(existingServices.map((s) => [s.name, s.id]))
  const stMap = new Map(existingStylists.map((s) => [s.name, s.id]))

  return {
    residents: {
      'mrs-smith': rMap.get('Mrs. Margaret Smith') ?? '',
      'mr-johnson': rMap.get('Mr. Robert Johnson') ?? '',
    },
    services: {
      'wash-and-set': sMap.get('Wash & Set (Demo)') ?? '',
      haircut: sMap.get('Haircut (Demo)') ?? '',
    },
    stylists: {
      'demo-sarah': stMap.get('Demo Sarah') ?? '',
    },
  }
}
