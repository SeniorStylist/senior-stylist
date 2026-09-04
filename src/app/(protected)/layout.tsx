import { getAuthUser } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { ensureFacilitiesSchema } from '@/lib/facilities-ddl'
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
import { AssistantAnnouncementBanner } from '@/components/announcements/assistant-announcement-banner'
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

// P60 — `isMaster` rides the cache key (unstable_cache keys on the serialized
// args), so the owner's all-facilities list and a normal user's membership
// list can never share an entry.
async function fetchMembershipData(userId: string, isMaster = false): Promise<MembershipData> {
  // P63 — `with: { facility: true }` was an uncapped SELECT * lateral join
  // pulling all ~40 facility columns per membership row, including
  // stripe_secret_key, qb_access_token and qb_refresh_token — secrets this
  // function never reads and which had no business crossing the wire. Now the
  // five columns actually used below. (Skipping the join entirely for the master,
  // for whom it is dead weight, costs more in type gymnastics than the join is
  // worth on a handful of his own membership rows.)
  const userFacilities = await db.query.facilityUsers.findMany({
    where: eq(facilityUsers.userId, userId),
    with: { facility: { columns: { id: true, name: true, facilityCode: true, active: true, isDemo: true } } },
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
  // P60 — the MASTER gets the same complete list (synthetic 'admin' where no
  // explicit row exists — the shape GET /api/facilities already returns him).
  // Before this his switcher only listed facilities he had personally created
  // through POST /api/facilities (the one path that grants him a row); imported
  // facilities were unreachable from the switcher entirely.
  const hasBookkeeperRole = userFacilities.some((fu) => fu.role === 'bookkeeper')
  if (hasBookkeeperRole || isMaster) {
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
      // P61 — the OWNER is always 'admin' here. A stray non-admin membership
      // row (a leftover `stylist` row from a debug session, say) otherwise won
      // at :154 and became `activeRole`, which hides the facility switcher
      // entirely (sidebar.tsx gates it on admin|bookkeeper).
      role: isMaster ? 'admin' : (explicitRoles.get(f.id) ?? 'bookkeeper'),
    }))
  }

  // For super_admin users, restrict facility switcher to their franchise only.
  //
  // P61 — `&& !isMaster` is LOAD-BEARING. This filter runs twelve lines after the
  // expansion above and used to apply to the owner too, silently undoing it: a
  // master who holds ANY super_admin row saw only that franchise's facilities,
  // and a facility he creates is never franchise-linked (api/facilities/route.ts
  // skips the membership/franchise block for `isMaster`), so it was always
  // excluded. Worse, one click of the Debug tab's "Set up demo franchise" grants
  // him super_admin rows on DEMO facilities, which the expansion already
  // excludes — intersection empty, switcher gone. Never narrow the owner.
  const hasSuperAdminRole = userFacilities.some((fu) => fu.role === 'super_admin')
  if (hasSuperAdminRole && !isMaster) {
    const franchise = await db.query.franchises.findFirst({
      where: eq(franchises.ownerUserId, userId),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
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

async function fetchLayoutData(userId: string, isMaster = false): Promise<LayoutData> {
  // Phase 18 hotfix, extended in P63 — self-heal the `facilities` columns that
  // ship ahead of their migration (monthly_report_enabled, and the timezone
  // column that has never had one). Full-row facilities selects throw "column
  // does not exist" when code deploys before the migration; this makes deploys
  // order-proof. Module-guarded in facilities-ddl.ts — one attempt per instance,
  // and it no longer re-arms on failure (that turned a struggling instance into
  // an ACCESS EXCLUSIVE retry on every render).
  await ensureFacilitiesSchema().catch(() => {})

  const cookieStore = await cookies()
  const selectedId = cookieStore.get('selected_facility_id')?.value

  let membership: MembershipData
  try {
    membership = await getCachedMembershipData(userId, isMaster)
    // Never trust a cached EMPTY result — a just-redeemed invite must see its
    // new facility immediately even if a stale entry predates the tag bust.
    // P60 — same for a cached list that doesn't contain the facility the
    // cookie points at: a just-created facility would otherwise be mislabeled
    // as the OLDEST membership row (allFacilities[0]) while every page, which
    // reads getUserFacility uncached, showed the real one — the "app says
    // Fitzgerald, switcher says F121" demo bug.
    // P63 — the emptiness test is meaningless for the OWNER: P60 made his access
    // synthetic, so he legitimately needs no membership rows, yet this forced an
    // uncached repeat of BOTH membership queries on every single render. And the
    // second disjunct is now redundant in general — P61 resolves and prepends a
    // facility the list doesn't contain a few lines below, so re-running the same
    // query with the same predicates can't help; it only doubled the work for
    // anyone parked on a demo facility (Apley) or an impersonated one.
    const stale =
      (!isMaster && membership.memberships.length === 0) ||
      (!isMaster && selectedId != null && !membership.allFacilities.some((f) => f.id === selectedId))
    if (stale) {
      membership = await fetchMembershipData(userId, isMaster)
    }
  } catch {
    membership = await fetchMembershipData(userId, isMaster)
  }
  let allFacilities = membership.allFacilities

  // P61 — ONE answer to "which facility am I in".
  //
  // Every page resolves its facility through getUserFacility(). The layout used
  // to compute its OWN answer from a list it had filtered differently, and when
  // the two disagreed the page rendered "Fitzgerald" while the sidebar said
  // "F121" — the bug Josh reported twice. The switcher list and the active
  // facility are now different questions with one shared answer: the list is
  // what you may switch TO, getUserFacility says where you ARE.
  //
  // getUserFacility is React.cache()'d, so on any page that also calls it (most
  // of them) this is deduped to zero extra work. It also honours the debug
  // impersonation cookie, so the sidebar now names the impersonated facility
  // instead of an unrelated one.
  const fu = await getUserFacility(userId).catch(() => null)
  const resolvedId = fu?.facilityId ?? selectedId ?? allFacilities[0]?.id ?? null

  let active = allFacilities.find((f) => f.id === resolvedId)
  if (!active && resolvedId) {
    // Resolved to a facility the switcher list doesn't contain — a demo facility
    // (getUserFacility and /api/facilities/select accept any ACTIVE facility,
    // while the list excludes demo ones), or one a filter above removed. Name it
    // correctly regardless: a corner that shows a different facility than the
    // page is the entire class of bug this replaces.
    const row = await db.query.facilities.findFirst({
      where: eq(facilities.id, resolvedId),
      columns: { id: true, name: true, facilityCode: true },
    })
    if (row) {
      active = { id: row.id, name: row.name, facilityCode: row.facilityCode ?? null, role: fu?.role ?? 'admin' }
      allFacilities = [active, ...allFacilities]
    }
  }

  // Role + franchise signal come from the same resolution, so they can't drift
  // from the facility they describe. getUserFacility already normalizes
  // super_admin -> admin and preserves the original as rawRole (P51).
  const rawRole = fu?.role ?? active?.role ?? 'admin'
  const franchiseAdmin = fu?.rawRole === 'super_admin'

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

  // P61 — trimmed + case-insensitive. This was a bare `===` against the raw env
  // var, so a stray space or a capital letter in the deployed value silently
  // demoted the owner to his membership rows. Mirrors isMasterAdmin()'s intent.
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL?.trim().toLowerCase()
  const isMaster = !!superAdminEmail && user.email?.trim().toLowerCase() === superAdminEmail

  let facilityData: LayoutData | null = null
  // P61 — a failure here used to be indistinguishable from "you have no
  // facilities": the switcher simply didn't render, with no error and no log.
  // Track it so the sidebar can say "couldn't load" and offer a reload.
  let facilityLoadFailed = false
  try {
    // P63 — the timer is cleared on the happy path; it used to leak an 8s handle
    // per layout render, and the layout re-renders on every nav-link prefetch.
    let timer: ReturnType<typeof setTimeout> | undefined
    facilityData = await Promise.race([
      fetchLayoutData(user.id, isMaster),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), LAYOUT_TIMEOUT_MS)
      }),
    ]).finally(() => { if (timer) clearTimeout(timer) })
    if (!facilityData) {
      facilityLoadFailed = true
      console.error(`[layout] facility data timed out after ${LAYOUT_TIMEOUT_MS}ms for user ${user.id}`)
    }
  } catch (err) {
    facilityLoadFailed = true
    console.error('[layout] facility data failed:', err)
  }

  if (facilityData) {
    facilityName = facilityData.facilityName
    facilityCode = facilityData.facilityCode
    allFacilities = facilityData.allFacilities
    activeRole = facilityData.activeRole
    activeFacilityId = facilityData.activeFacilityId
    changelogLastReadAt = facilityData.changelogLastReadAt
  }

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
      {/* One-time AI-assistant announcement (all roles) — changelog-date gated */}
      <AssistantAnnouncementBanner changelogLastReadAt={changelogLastReadAt} />
      <NavigationProgress />
      <div className="hidden md:flex">
        <Sidebar user={user} facilityName={facilityName} facilityCode={facilityCode} allFacilities={allFacilities} role={activeRole} debugMode={debugMode} isFranchiseAdmin={franchiseAdmin} activeFacilityId={activeFacilityId} facilityLoadFailed={facilityLoadFailed} />
      </div>
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <MobileFacilityHeader facilityName={facilityName} facilityCode={facilityCode} allFacilities={allFacilities} role={activeRole} debugMode={debugMode} activeFacilityId={activeFacilityId} />
        <TopBar facilityName={facilityName} facilityCode={facilityCode} role={activeRole} changelogLastReadAt={changelogLastReadAt} />
        <div className="main-content flex-1 min-h-0 overflow-auto">
          <ToastProvider>
            <TourRouterProvider />
            <TourResumer />
            <MobileTourOverlay />
            {/* P47 — every role except viewer: pages + the Ask-AI handoff;
                resident/stylist search stays admin/bookkeeper/master. */}
            {(activeRole !== 'viewer' || isMaster) && (
              <CommandPalette
                role={activeRole}
                isMaster={isMaster}
                facilityId={activeFacilityId}
                canSearchEntities={isMaster || activeRole === 'admin' || activeRole === 'bookkeeper'}
                canManage={isMaster || franchiseAdmin || activeRole === 'bookkeeper'}
              />
            )}
            <PeekDrawer role={activeRole} isMaster={isMaster} canManage={isMaster || franchiseAdmin || activeRole === 'bookkeeper'} />
            <ScriptedTourOverlay />
            <FeedbackWidget />
            {/* P38 — AI personal assistant (all roles; capability enforced server-side) */}
            <AssistantWidget role={activeRole} isMaster={isMaster} />
            <KeyboardShortcuts />
            {children}
          </ToastProvider>
        </div>
      </main>
      <MobileNav role={activeRole} debugMode={debugMode} userId={user.id} isMaster={isMaster} isFranchiseAdmin={franchiseAdmin} />
      <MobileDebugButton isMaster={isMaster} allFacilities={allFacilities} currentFacilityId={activeFacilityId} />
      <InstallBanner />
      <DebugBadge />
      <SWRegister userId={user.id} role={activeRole} />
    </div>
  )
}
