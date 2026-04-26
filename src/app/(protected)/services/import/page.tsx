import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserFacility, isAdminOrAbove } from '@/lib/get-facility-id'
import { ImportClient } from './import-client'

export default async function ServicesImportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (!isAdminOrAbove(facilityUser.role)) redirect('/dashboard')
  return <ImportClient />
}
