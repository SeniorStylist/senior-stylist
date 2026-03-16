import { db } from '@/db'
import { stylists } from '@/db/schema'
import { eq, and } from 'drizzle-orm'

export async function getStylistsByFacility(facilityId: string) {
  return db.query.stylists.findMany({
    where: and(eq(stylists.facilityId, facilityId), eq(stylists.active, true)),
    orderBy: (t, { asc }) => [asc(t.name)],
  })
}

export async function getStylistById(id: string) {
  return db.query.stylists.findFirst({
    where: eq(stylists.id, id),
  })
}
