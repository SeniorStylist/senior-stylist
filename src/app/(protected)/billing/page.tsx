import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { BillingClient } from './billing-client'

export default async function BillingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  // Run facilityUser lookup and (master-only) facility list in parallel.
  const [facilityUser, masterList] = await Promise.all([
    isMaster ? Promise.resolve(null) : getUserFacility(user.id),
    isMaster
      ? db.query.facilities.findMany({
          where: eq(facilities.active, true),
          columns: { id: true, name: true, facilityCode: true },
        })
      : Promise.resolve(null),
  ])

  if (!isMaster && (!facilityUser || !canAccessBilling(facilityUser.role))) {
    redirect('/dashboard')
  }

  let initialFacilityId: string
  let facilityOptions: { id: string; name: string; facilityCode: string | null }[] = []

  if (isMaster) {
    const list = masterList ?? []
    list.sort((a, b) => {
      const aNum = a.facilityCode ? parseInt(a.facilityCode.replace(/\D/g, ''), 10) : Infinity
      const bNum = b.facilityCode ? parseInt(b.facilityCode.replace(/\D/g, ''), 10) : Infinity
      return aNum !== bNum ? aNum - bNum : (a.name ?? '').localeCompare(b.name ?? '')
    })
    facilityOptions = list
    initialFacilityId = list[0]?.id ?? ''
  } else {
    initialFacilityId = facilityUser!.facilityId
  }

  return (
    <Suspense fallback={null}>
      <BillingClient
        initialFacilityId={initialFacilityId}
        facilityOptions={facilityOptions}
        isMaster={isMaster}
      />
    </Suspense>
  )
}
