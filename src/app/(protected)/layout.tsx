import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilityUsers, franchises } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { Sidebar } from '@/components/layout/sidebar'
import { TopBar } from '@/components/layout/top-bar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { ToastProvider } from '@/components/ui/toast'
import InstallBanner from '@/components/pwa/install-banner'
import { NavigationProgress } from '@/components/ui/navigation-progress'
import { DebugBadge } from '@/components/debug/debug-badge'
import { MobileFacilityHeader } from '@/components/layout/mobile-facility-header'
import { MobileDebugButton } from '@/components/layout/mobile-debug-button'
import { TourResumer } from '@/components/help/tour-resumer'
import { MobileTourOverlay } from '@/components/help/mobile-tour-overlay'
import { TourModeBanner } from '@/components/help/tour-mode-banner'
import { TourRouterProvider } from '@/components/help/tour-router-provider'

const LAYOUT_TIMEOUT_MS = 8000

interface LayoutData {
  facilityName: string | undefined
  facilityCode: string | null
  allFacilities: { id: string; name: string; facilityCode: string | null; role: string }[]
  activeRole: string
  activeFacilityId: string
}

async function fetchLayoutData(userId: string): Promise<LayoutData> {
  const userFacilities = await db.query.facilityUsers.findMany({
    where: eq(facilityUsers.userId, userId),
    with: { facility: true },
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  })

  let allFacilities = userFacilities
    .filter((fu) => fu.facility != null)
    .map((fu) => ({
      id: fu.facilityId,
      name: fu.facility!.name,
      facilityCode: fu.facility!.facilityCode ?? null,
      role: fu.role,
    }))

  // For super_admin users, restrict facility switcher to their franchise only
  const hasSuperAdminRole = userFacilities.some((fu) => fu.role === 'super_admin')
  if (hasSuperAdminRole) {
    const franchise = await db.query.franchises.findFirst({
      where: eq(franchises.ownerUserId, userId),
      with: { franchiseFacilities: true },
    })
    if (franchise) {
      const franchiseFacilityIds = new Set(franchise.franchiseFacilities.map((ff) => ff.facilityId))
      allFacilities = allFacilities.filter((f) => franchiseFacilityIds.has(f.id))
    }
  }

  const cookieStore = await cookies()
  const selectedId = cookieStore.get('selected_facility_id')?.value
  const active = allFacilities.find((f) => f.id === selectedId) ?? allFacilities[0]
  const rawRole = active?.role ?? 'admin'

  return {
    facilityName: active?.name,
    facilityCode: active?.facilityCode ?? null,
    allFacilities,
    activeFacilityId: active?.id ?? '',
    activeRole: rawRole === 'super_admin' ? 'admin' : rawRole,
  }
}

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  let facilityName: string | undefined
  let facilityCode: string | null = null
  let allFacilities: { id: string; name: string; facilityCode: string | null; role: string }[] = []
  let activeRole: string = 'admin'
  let activeFacilityId: string = ''

  let facilityData: LayoutData | null = null
  try {
    facilityData = await Promise.race([
      fetchLayoutData(user.id),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), LAYOUT_TIMEOUT_MS)
      ),
    ])
  } catch {
    // ignore
  }

  if (facilityData) {
    facilityName = facilityData.facilityName
    facilityCode = facilityData.facilityCode
    allFacilities = facilityData.allFacilities
    activeRole = facilityData.activeRole
    activeFacilityId = facilityData.activeFacilityId
  }

  const isMaster = user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  let debugMode = false
  if (isMaster) {
    const cookieStore = await cookies()
    const debugRaw = cookieStore.get('__debug_role')?.value
    if (debugRaw) {
      try {
        const debug = JSON.parse(debugRaw) as { role: string; facilityId: string; facilityName: string }
        if (debug.role && debug.facilityId) {
          activeRole = debug.role === 'super_admin' ? 'admin' : debug.role
          facilityName = debug.facilityName
          activeFacilityId = debug.facilityId
          debugMode = true
        }
      } catch { /* malformed */ }
    }
  }

  return (
    <div className="flex h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <TourModeBanner />
      <NavigationProgress />
      <div className="hidden md:flex">
        <Sidebar user={user} facilityName={facilityName} facilityCode={facilityCode} allFacilities={allFacilities} role={activeRole} debugMode={debugMode} />
      </div>
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <MobileFacilityHeader facilityName={facilityName} facilityCode={facilityCode} allFacilities={allFacilities} role={activeRole} debugMode={debugMode} />
        <TopBar facilityName={facilityName} facilityCode={facilityCode} role={activeRole} />
        <div className="main-content flex-1 min-h-0 overflow-auto">
          <ToastProvider>
            <TourRouterProvider />
            <TourResumer />
            <MobileTourOverlay />
            {children}
          </ToastProvider>
        </div>
      </main>
      <MobileNav role={activeRole} debugMode={debugMode} />
      <MobileDebugButton isMaster={isMaster} allFacilities={allFacilities} currentFacilityId={activeFacilityId} />
      <InstallBanner />
      <DebugBadge />
    </div>
  )
}
