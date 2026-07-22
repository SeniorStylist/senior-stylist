import { getAuthUser } from '@/lib/supabase/server'
import { ensureMonthlyReportSchema } from '@/lib/monthly-report-ddl'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilities, facilityUsers, franchises } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { unstable_cache } from 'next/cache'
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
import { CommandPalette } from '@/components/command-palette/command-palette'
import { PeekDrawer } from '@/components/peek-drawer/peek-drawer'
import { ScriptedTourOverlay } from '@/components/help/scripted-tour/scripted-tour-overlay'
import { FeedbackWidget } from '@/components/feedback/feedback-widget'
import { AssistantWidget } from '@/components/assistant/assistant-widget'
import { KeyboardShortcuts } from '@/components/shortcuts/keyboard-shortcuts'
import { SWRegister } from '@/components/pwa/sw-register'

const LAYOUT_TIMEOUT_MS = 8000

interface LayoutData {
  facilityName: string | undefined
  facilityCode: string | null
  allFacilities: { id: string; name: string; facilityCode: string | null; role: string }[]
  activeRole: string
  activeFacilityId: string
  changelogLastReadAt: string | null
  franchiseAdmin: boolean
}

// P31 — the membership/facility-list queries run on EVERY layout render (every
// navigation AND every nav-link prefetch) but their data changes rarely. They
// are cached per user for 5 minutes under the 'facilities' tag, which every
// facility CRUD + membership mutation busts (invite redeem, access-request
// approve, member removal, admin setup, login self-heal). P26 rule: the cached
// value is JSON-plain (no Dates/Maps — warm hits are JSON round-tripped).
// P27 rule: no try/catch inside — a failure must propagate, not get cached;
// the call site falls back to the uncached fetch.
interface MembershipData {
  memberships: { facilityId: string; role: string }[]
  allFacilities: { id: string; name: string; facilityCode: string | null; role: string }[]
}

async function fetchMembershipData(userId: string): Promise<MembershipData> {
  const userFacilities = await db.query.facilityUsers.findMany({
    where: eq(facilityUsers.userId, userId),
    with: { facility: true },
    orderBy: (t, { asc }) => [asc(t.createdAt)],
  })

  let allFacilities = userFacilities
    .filter((fu) => fu.facility != null && fu.facility.active && !fu.facility.isDemo)
    .map((fu) => ({
      id: fu.facilityId,
      name: fu.facility!.name,
      facilityCode: fu.facility!.facilityCode ?? null,
      role: fu.role,
    }))

  // Bookkeepers have cross-facility access by role — the switcher lists every
  // active facility, not just the ones with explicit facility_users rows.
  const hasBookkeeperRole = userFacilities.some((fu) => fu.role === 'bookkeeper')
  if (hasBookkeeperRole) {
    const explicitRoles = new Map(allFacilities.map((f) => [f.id, f.role]))
    const activeFacilities = await db.query.facilities.findMany({
      where: and(eq(facilities.active, true), eq(facilities.isDemo, false)),
      columns: { id: true, name: true, facilityCode: true },
      orderBy: (t, { asc }) => [asc(t.name)],
    })
    allFacilities = activeFacilities.map((f) => ({
      id: f.id,
      name: f.name,
      facilityCode: f.facilityCode ?? null,
      role: explicitRoles.get(f.id) ?? 'bookkeeper',
    }))
  }

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

  return {
    memberships: userFacilities.map((fu) => ({ facilityId: fu.facilityId, role: fu.role })),
    allFacilities,
  }
}

const getCachedMembershipData = unstable_cache(fetchMembershipData, ['layout-membership-v1'], {
  revalidate: 300,
  tags: ['facilities'],
})

async function fetchLayoutData(userId: string): Promise<LayoutData> {
  // Phase 18 hotfix — self-heal the facilities.monthly_report_enabled column
  // (drizzle/0024). Full-row facilities selects (this relation include, the
  // dashboard, the daily log) throw "column does not exist" when the code
  // deploys before the migration is applied; this makes deploys order-proof.
  // Module-guarded in monthly-report-ddl.ts — one round-trip per instance.
  await ensureMonthlyReportSchema().catch(() => {})

  let membership: MembershipData
  try {
    membership = await getCachedMembershipData(userId)
    // Never trust a cached EMPTY result — a just-redeemed invite must see its
    // new facility immediately even if a stale entry predates the tag bust.
    if (membership.memberships.length === 0) {
      membership = await fetchMembershipData(userId)
    }
  } catch {
    membership = await fetchMembershipData(userId)
  }
  const { memberships, allFacilities } = membership

  const cookieStore = await cookies()
  const selectedId = cookieStore.get('selected_facility_id')?.value
  const active = allFacilities.find((f) => f.id === selectedId) ?? allFacilities[0]
  const rawRole = active?.role ?? 'admin'

  // Phase 25 — franchise-admin signal derived from the rows already in hand
  // (was a second identical facility_users query via isFranchiseAdmin()).
  // Mirrors isFranchiseAdmin's semantics: RAW role of the selected facility's
  // row, falling back to the first row. The debug-cookie override is handled
  // by the caller (master-only branch below).
  const selectedRaw = selectedId
    ? memberships.find((fu) => fu.facilityId === selectedId)
    : undefined
  const franchiseAdmin = (selectedRaw ?? memberships[0])?.role === 'super_admin'

  const profileRow = await db.query.profiles.findFirst({
    where: (p, { eq }) => eq(p.id, userId),
    columns: { changelogLastReadAt: true },
  })

  return {
    facilityName: active?.name,
    facilityCode: active?.facilityCode ?? null,
    allFacilities,
    activeFacilityId: active?.id ?? '',
    activeRole: rawRole === 'super_admin' ? 'admin' : rawRole,
    changelogLastReadAt: profileRow?.changelogLastReadAt?.toISOString() ?? null,
    franchiseAdmin,
  }
}

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Phase 25 — getAuthUser() is React.cache()-deduped: the page this layout
  // wraps shares the same auth round-trip instead of paying a second one.
  const user = await getAuthUser()

  if (!user) redirect('/login')

  let facilityName: string | undefined
  let facilityCode: string | null = null
  let allFacilities: { id: string; name: string; facilityCode: string | null; role: string }[] = []
  let activeRole: string = 'admin'
  let activeFacilityId: string = ''
  let changelogLastReadAt: string | null = null

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
    changelogLastReadAt = facilityData.changelogLastReadAt
  }

  const isMaster = user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

  let debugMode = false
  let franchiseAdmin = false
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
          // Impersonating a franchise admin → show the Franchise nav + dashboard.
          franchiseAdmin = debug.role === 'super_admin'
        }
      } catch { /* malformed */ }
    }
  }
  // Real franchise owners (raw super_admin role) also get the Franchise nav.
  // Derived inside fetchLayoutData from rows already fetched (Phase 25 — was a
  // duplicate facility_users query via isFranchiseAdmin()).
  if (!debugMode) {
    franchiseAdmin = facilityData?.franchiseAdmin ?? false
  }

  return (
    // P39b — `flex h-screen` is the ONLY verified shell sizing. Do NOT change
    // this line without on-device verification:
    // - `fixed inset-0` (tried P39, reverted same day): the installed/native
    //   app insets the fixed layer — bottom nav floated ~130px above the real
    //   screen bottom with dead bands top+bottom (Josh screenshot 2026-07-22).
    //   The old CLAUDE.md "Layout Shell" section claiming fixed inset-0 was
    //   the verified pattern was STALE — the codebase had already moved off it.
    // - `h-[100dvh]`: the documented iOS cold-load bug (mis-measured before
    //   the URL-bar state settles).
    <div className="flex h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <TourModeBanner />
      <NavigationProgress />
      <div className="hidden md:flex">
        <Sidebar user={user} facilityName={facilityName} facilityCode={facilityCode} allFacilities={allFacilities} role={activeRole} debugMode={debugMode} isFranchiseAdmin={franchiseAdmin} />
      </div>
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <MobileFacilityHeader facilityName={facilityName} facilityCode={facilityCode} allFacilities={allFacilities} role={activeRole} debugMode={debugMode} />
        <TopBar facilityName={facilityName} facilityCode={facilityCode} role={activeRole} changelogLastReadAt={changelogLastReadAt} />
        <div className="main-content flex-1 min-h-0 overflow-auto">
          <ToastProvider>
            <TourRouterProvider />
            <TourResumer />
            <MobileTourOverlay />
            {(activeRole === 'admin' || activeRole === 'bookkeeper' || isMaster) && (
              <CommandPalette
                role={activeRole}
                isMaster={isMaster}
                facilityId={activeFacilityId}
              />
            )}
            <PeekDrawer role={activeRole} isMaster={isMaster} />
            <ScriptedTourOverlay />
            <FeedbackWidget />
            {/* P38 — AI personal assistant (all roles; capability enforced server-side) */}
            <AssistantWidget role={activeRole} isMaster={isMaster} />
            <KeyboardShortcuts />
            {children}
          </ToastProvider>
        </div>
      </main>
      <MobileNav role={activeRole} debugMode={debugMode} userId={user.id} />
      <MobileDebugButton isMaster={isMaster} allFacilities={allFacilities} currentFacilityId={activeFacilityId} />
      <InstallBanner />
      <DebugBadge />
      <SWRegister userId={user.id} role={activeRole} />
    </div>
  )
}
