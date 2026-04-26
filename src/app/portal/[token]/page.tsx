import { redirect } from 'next/navigation'
import { db } from '@/db'
import { residents, facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export default async function LegacyPortalRedirect({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const resident = await db.query.residents.findFirst({
    where: eq(residents.portalToken, token),
    columns: { facilityId: true },
  })
  if (resident?.facilityId) {
    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, resident.facilityId),
      columns: { facilityCode: true },
    })
    if (facility?.facilityCode) {
      redirect(`/family/${encodeURIComponent(facility.facilityCode)}`)
    }
  }
  redirect('/')
}
