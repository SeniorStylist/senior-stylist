import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ImportFacilitiesCSVClient } from './import-facilities-csv-client'

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) redirect('/dashboard')
  return <ImportFacilitiesCSVClient />
}
