import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { requirePortalAuth } from '@/lib/portal-auth'
import { getPortalCoupons } from '@/lib/portal-coupons'
import { ProfileClient } from './profile-client'

export const dynamic = 'force-dynamic'

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ facilityCode: string }>
}) {
  const { facilityCode } = await params
  const decoded = decodeURIComponent(facilityCode)
  const { session, residentsAtFacility } = await requirePortalAuth(decoded)

  const facilityId = residentsAtFacility[0]?.facilityId ?? null

  const ids = residentsAtFacility.map((r) => r.residentId)
  const [rows, coupons] = await Promise.all([
    ids.length
      ? db.query.residents.findMany({
          where: inArray(residents.id, ids),
          columns: {
            id: true,
            name: true,
            roomNumber: true,
            defaultTipType: true,
            defaultTipValue: true,
            phone: true,
            poaName: true,
            poaEmail: true,
            poaPhone: true,
            poaAddress: true,
            poaCity: true,
          },
        })
      : Promise.resolve([]),
    facilityId
      ? getPortalCoupons(facilityId, session.portalAccountId).catch(() => [])
      : Promise.resolve([]),
  ])

  // Preserve facility-resident ordering from the session
  const ordered = ids
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => r != null)

  return <ProfileClient residents={ordered} facilityCode={decoded} coupons={coupons} />
}
