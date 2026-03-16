import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

export async function getResidentsByFacility(facilityId: string) {
  return db.query.residents.findMany({
    where: and(eq(residents.facilityId, facilityId), eq(residents.active, true)),
    orderBy: (t, { asc }) => [asc(t.name)],
  })
}

export async function getResidentById(id: string) {
  return db.query.residents.findFirst({
    where: eq(residents.id, id),
  })
}
