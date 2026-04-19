import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ImportQuickbooksClient } from './import-quickbooks-client'

export default async function ImportQuickbooksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) redirect('/dashboard')

  return <ImportQuickbooksClient />
}
