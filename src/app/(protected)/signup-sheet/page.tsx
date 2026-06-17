import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { residents, services, stylists } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { isTutorialModeActive } from '@/lib/help/tutorial-request'
import { SignupSheetPageClient } from './signup-sheet-client'

export default async function SignupSheetPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (facilityUser.role !== 'admin' && facilityUser.role !== 'facility_staff') {
    redirect('/dashboard')
  }

  const tutorialMode = await isTutorialModeActive()

  const [facility, residentsList, servicesList, stylistsList] = await Promise.all([
    db.query.facilities.findFirst({
      where: (t, { eq }) => eq(t.id, facilityUser.facilityId),
    }),
    db.query.residents.findMany({
      where: and(
        eq(residents.facilityId, facilityUser.facilityId),
        eq(residents.active, true),
        eq(residents.isDemo, tutorialMode), // is_demo filter — Phase 13
      ),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.services.findMany({
      where: and(
        eq(services.facilityId, facilityUser.facilityId),
        eq(services.active, true),
        eq(services.isDemo, tutorialMode), // is_demo filter — Phase 13
      ),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db.query.stylists.findMany({
      where: and(
        eq(stylists.facilityId, facilityUser.facilityId),
        eq(stylists.active, true),
        eq(stylists.isDemo, tutorialMode), // is_demo filter — Phase 13
      ),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
  ])

  if (!facility) redirect('/dashboard')

  return (
    <SignupSheetPageClient
      facilityId={facilityUser.facilityId}
      facilityTimezone={facility.timezone ?? 'America/New_York'}
      residents={JSON.parse(JSON.stringify(residentsList))}
      services={JSON.parse(JSON.stringify(servicesList))}
      stylists={JSON.parse(JSON.stringify(stylistsList))}
      role={facilityUser.role}
    />
  )
}
