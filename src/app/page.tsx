import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { landingPathFor } from '@/lib/landing'

export const dynamic = 'force-dynamic'

// P51 — the landing brain: each role starts on its most useful page.
// No-facility users go to /dashboard, whose existing chain owns the
// master-admin / invite / onboarding / unauthorized routing.
export default async function Home() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  const fu = await getUserFacility(user.id)
  if (!fu && !isMaster) redirect('/dashboard')

  redirect(landingPathFor({ role: fu?.role ?? '', rawRole: fu?.rawRole, isMaster }))
}
