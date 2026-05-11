import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { HelpClient } from './help-client'

export default async function HelpPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  // Help is available to anyone with a facility; if none, send back to dashboard
  // which has its own onboarding-vs-unauthorized branching.
  if (!facilityUser) redirect('/dashboard')

  // Debug-mode impersonation override (mirrors layout.tsx). When master admin is
  // impersonating, treat them as the debug role — NOT as master — so the help
  // page shows the impersonated role's tutorials.
  const cookieStore = await cookies()
  const debugRaw = cookieStore.get('__debug_role')?.value
  let debugRole: string | null = null
  if (debugRaw) {
    try {
      const debug = JSON.parse(debugRaw) as { role?: string }
      if (debug.role) {
        debugRole = debug.role === 'super_admin' ? 'admin' : debug.role
      }
    } catch { /* malformed — ignore */ }
  }

  const isMaster =
    !debugRole &&
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  const effectiveRole = debugRole ?? facilityUser.role

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
    columns: { completedTours: true },
  })

  return (
    <HelpClient
      role={effectiveRole}
      isMaster={isMaster}
      completedTours={profile?.completedTours ?? []}
    />
  )
}
