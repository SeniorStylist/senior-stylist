import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
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

  const isMaster =
    !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  const profile = await db.query.profiles.findFirst({
    where: eq(profiles.id, user.id),
    columns: { completedTours: true },
  })

  return (
    <HelpClient
      role={facilityUser.role}
      isMaster={isMaster}
      completedTours={profile?.completedTours ?? []}
    />
  )
}
