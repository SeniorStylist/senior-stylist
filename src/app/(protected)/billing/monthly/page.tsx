// Monthly facility statement — month-by-month invoiced / services / collected /
// owed with expandable per-month detail. Master + admin + bookkeeper (same access
// as /billing). Facility options mirror billing/page.tsx.

import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { getUserFacility, canAccessBilling } from '@/lib/get-facility-id'
import { MonthlyClient } from './monthly-client'

export default async function MonthlyStatementPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  const facilityUser = isMaster ? null : await getUserFacility(user.id)
  if (!isMaster && (!facilityUser || !canAccessBilling(facilityUser.role))) {
    redirect('/dashboard')
  }

  const isBookkeeper = facilityUser?.role === 'bookkeeper'

  let initialFacilityId: string
  let facilityOptions: { id: string; name: string; facilityCode: string | null }[] = []

  if (isMaster || isBookkeeper) {
    const list = await db.query.facilities.findMany({
      where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
      columns: { id: true, name: true, facilityCode: true },
    })
    list.sort((a, b) => {
      const aNum = a.facilityCode ? parseInt(a.facilityCode.replace(/\D/g, ''), 10) : Infinity
      const bNum = b.facilityCode ? parseInt(b.facilityCode.replace(/\D/g, ''), 10) : Infinity
      return aNum !== bNum ? aNum - bNum : (a.name ?? '').localeCompare(b.name ?? '')
    })
    facilityOptions = list
    if (isMaster) {
      const cookieStore = await cookies()
      const selectedId = cookieStore.get('selected_facility_id')?.value
      const cookieMatch = selectedId ? list.find((f) => f.id === selectedId) : null
      initialFacilityId = cookieMatch?.id ?? list[0]?.id ?? ''
    } else {
      initialFacilityId = facilityUser!.facilityId
    }
  } else {
    initialFacilityId = facilityUser!.facilityId
  }

  return (
    <Suspense fallback={null}>
      <MonthlyClient
        initialFacilityId={initialFacilityId}
        facilityOptions={facilityOptions}
        isMaster={isMaster}
      />
    </Suspense>
  )
}
