import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ServiceLogClient } from './service-log-client'

export default async function ServiceLogImportPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) redirect('/dashboard')

  return <ServiceLogClient />
}
