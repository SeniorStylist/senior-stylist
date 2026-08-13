import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { residents, services, stylists, stylistFacilityAssignments } from '@/db/schema'
import { and, asc, eq, isNotNull, or } from 'drizzle-orm'
import { getUserFacility, isFacilityScheduleLocked } from '@/lib/get-facility-id'
import { isTutorialModeActive } from '@/lib/help/tutorial-request'
import { getPaymentCoverageMap } from '@/lib/payment-signals'
import { SignupSheetPageClient } from './signup-sheet-client'

export default async function SignupSheetPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (facilityUser.role !== 'admin' && facilityUser.role !== 'facility_staff') {
    redirect('/dashboard')
  }

  const tutorialMode = await isTutorialModeActive()

  const [facility, residentsList, servicesList, stylistsList, paymentFlags] = await Promise.all([
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
        eq(services.source, 'price_list'), // price-list catalog only (hide bookkeeper ad-hoc)
      ),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    // P53/P33 roster rule — home rows PLUS active assignment-linked rows:
    // assignment-shared stylists (franchise pool) were unpickable here.
    db
      .select({ id: stylists.id, name: stylists.name, color: stylists.color })
      .from(stylists)
      .leftJoin(
        stylistFacilityAssignments,
        and(
          eq(stylistFacilityAssignments.stylistId, stylists.id),
          eq(stylistFacilityAssignments.facilityId, facilityUser.facilityId),
          eq(stylistFacilityAssignments.active, true),
        ),
      )
      .where(
        and(
          or(
            eq(stylists.facilityId, facilityUser.facilityId),
            isNotNull(stylistFacilityAssignments.stylistId),
          ),
          eq(stylists.active, true),
          eq(stylists.isDemo, tutorialMode), // is_demo filter — Phase 13
        ),
      )
      .orderBy(asc(stylists.name)),
    // P51 — card-on-file / salon-credit booleans per resident
    getPaymentCoverageMap(facilityUser.facilityId),
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
      paymentFlags={paymentFlags}
      scheduleLocked={isFacilityScheduleLocked(facilityUser)}
    />
  )
}
