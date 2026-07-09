import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ImportFacilitiesCSVClient } from './import-facilities-csv-client'

export default async function Page() {
  const user = await getAuthUser()
  if (!user || user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) redirect('/dashboard')
  return <ImportFacilitiesCSVClient />
}
