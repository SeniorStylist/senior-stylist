import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { CrossFacilityReportClient } from '../components/cross-facility-report-client'

export default async function OutstandingPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')
  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!isMaster) redirect('/billing')
  return <CrossFacilityReportClient type="outstanding" />
}
