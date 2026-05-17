import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities, facilityUsers } from '@/db/schema'
import { eq, inArray, asc } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { ReportsClient } from './reports-client'

export default async function AnalyticsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser || !canAccessBilling(facilityUser.role)) redirect('/dashboard')

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, facilityUser.facilityId),
  })

  const paymentType = facility?.paymentType ?? 'facility'
  const facilityId = facilityUser.facilityId

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  let exportFacilities: { id: string; name: string; facilityCode: string | null }[] = []
  if (isMaster) {
    const rows = await db.query.facilities.findMany({
      where: eq(facilities.active, true),
      columns: { id: true, name: true, facilityCode: true },
      orderBy: [asc(facilities.name)],
    })
    exportFacilities = rows.map((r) => ({ id: r.id, name: r.name, facilityCode: r.facilityCode }))
  } else {
    const memberships = await db.query.facilityUsers.findMany({
      where: eq(facilityUsers.userId, user.id),
      columns: { facilityId: true },
    })
    const ids = memberships.map((m) => m.facilityId)
    if (ids.length > 0) {
      const rows = await db.query.facilities.findMany({
        where: inArray(facilities.id, ids),
        columns: { id: true, name: true, facilityCode: true },
        orderBy: [asc(facilities.name)],
      })
      exportFacilities = rows.map((r) => ({ id: r.id, name: r.name, facilityCode: r.facilityCode }))
    }
  }

  return (
    <ReportsClient
      paymentType={paymentType}
      facilityId={facilityId}
      facilityTimezone={facility?.timezone ?? 'America/New_York'}
      revShareType={facility?.qbRevShareType ?? null}
      revSharePercentage={facility?.revSharePercentage ?? null}
      exportFacilities={exportFacilities}
    />
  )
}
