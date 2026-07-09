import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { QbImportClient } from './qb-import-client'

export default async function QuickBooksImportsPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) redirect('/dashboard')

  return <QbImportClient />
}
