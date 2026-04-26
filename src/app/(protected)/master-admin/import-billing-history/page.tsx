import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ImportBillingHistoryClient } from './import-billing-history-client'

export default async function ImportBillingHistoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) redirect('/dashboard')

  return <ImportBillingHistoryClient />
}
