import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { ImportClient } from './import-client'

export default async function ResidentsImportPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role)) redirect('/dashboard')

  return <ImportClient />
}
