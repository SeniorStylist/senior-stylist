import { db } from '@/db'
import { services } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

export async function getServicesByFacility(facilityId: string) {
  return db.query.services.findMany({
    where: and(eq(services.facilityId, facilityId), eq(services.active, true)),
    orderBy: (t, { asc }) => [asc(t.name)],
  })
}

export async function getServiceById(id: string) {
  return db.query.services.findFirst({
    where: eq(services.id, id),
  })
}
