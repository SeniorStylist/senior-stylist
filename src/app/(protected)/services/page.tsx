import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { services, facilities } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { isTutorialModeActive } from '@/lib/help/tutorial-request'
import { ServicesPageClient } from './services-page-client'

export default async function ServicesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role)) redirect('/dashboard')

  try {
  // is_demo filter — Phase 13. Demo-only during a scripted tour; real-only otherwise.
  const tutorialMode = await isTutorialModeActive()
  const [servicesList, facility] = await Promise.all([
    db.query.services.findMany({
      where: and(
        eq(services.facilityId, facilityUser.facilityId),
        eq(services.active, true),
        eq(services.isDemo, tutorialMode),
        // price-list catalog only — bookkeeper-added ad-hoc services load via the
        // "Show bookkeeper-added" toggle (GET /api/services?includeAdhoc=1)
        eq(services.source, 'price_list')
      ),
      orderBy: (t, { asc, desc }) => [desc(t.category), asc(t.name)],
    }),
    db.query.facilities.findFirst({
      where: eq(facilities.id, facilityUser.facilityId),
      columns: { serviceCategoryOrder: true },
    }),
  ])

  return (
    <ServicesPageClient
      services={JSON.parse(JSON.stringify(servicesList))}
      serviceCategoryOrder={facility?.serviceCategoryOrder ?? null}
    />
  )
  } catch (err) {
    console.error('[ServicesPage] DB error:', err)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg mt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">Failed to load services. Please refresh to try again.</p>
        </div>
      </div>
    )
  }
}
