import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
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

  return <ReportsClient paymentType={paymentType} facilityId={facilityId} />
}
