'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Building2,
  Users,
  CreditCard,
  Plug,
  Heart,
  Bell,
  SlidersHorizontal,
  Search,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PublicFacility } from '@/lib/sanitize'
import { createClient } from '@/lib/supabase/client'
import { GeneralSection } from './sections/general-section'
import { TeamSection, type ConnectedUser } from './sections/team-section'
import { BillingSection } from './sections/billing-section'
import { IntegrationsSection } from './sections/integrations-section'
import { NotificationsSection } from './sections/notifications-section'
import { AdvancedSection } from './sections/advanced-section'
import { PortalSection } from './sections/portal-section'

interface ClaimRequest {
  id: string
  email: string
  fullName: string
  phone: string | null
  dateOfBirth: string | null
  matchType: string | null
  matchConfidence: string | null
  residentName: string | null
  residentRoom: string | null
  createdAt: string
}

interface SettingsClientProps {
  facility: PublicFacility
  connectedUsers: ConnectedUser[]
  currentUserId: string
  currentUserEmail: string | null
  role: string
  isMaster?: boolean
  pendingRequestsCount: number
  adminEmail: string | null
  qbInvoiceSyncEnabled: boolean
  claimRequests: ClaimRequest[]
  pendingClaimsCount: number
}

type CategoryId = 'general' | 'team' | 'billing' | 'integrations' | 'notifications' | 'advanced' | 'portal'
type GroupId = 'facility' | 'people' | 'financial' | 'system'

interface CategoryDef {
  id: CategoryId
  label: string
  description: string
  icon: LucideIcon
  group: GroupId
  badge?: number
}

const GROUP_ORDER: GroupId[] = ['facility', 'people', 'financial', 'system']
const GROUP_LABELS: Record<GroupId, string> = {
  facility: 'Facility',
  people: 'People & Access',
  financial: 'Billing',
  system: 'System',
}

// Static metadata per category — icon + one-line description power both the nav
// and the content-pane header so users always know "what is what".
const CATEGORY_META: Record<CategoryId, { label: string; description: string; icon: LucideIcon; group: GroupId }> = {
  general: { label: 'General', description: 'Name, address, hours, and payment type.', icon: Building2, group: 'facility' },
  team: { label: 'Team & Roles', description: 'Invite teammates and manage their access.', icon: Users, group: 'people' },
  portal: { label: 'Family Portal', description: 'Portal access, self-signup, and coupons.', icon: Heart, group: 'people' },
  billing: { label: 'Billing & Payments', description: 'QuickBooks, Stripe, and revenue share.', icon: CreditCard, group: 'financial' },
  integrations: { label: 'Integrations', description: 'Google Calendar and other connections.', icon: Plug, group: 'system' },
  notifications: { label: 'Notifications', description: 'Email alerts and reminder recipients.', icon: Bell, group: 'system' },
  advanced: { label: 'Advanced', description: 'Tutorial data, service order, and facility tools.', icon: SlidersHorizontal, group: 'system' },
}

// Static tour-anchor slugs per category — keeps the literal strings discoverable
// to scripts/check-tours.ts (template-literal construction would hide them).
const TOUR_SLUGS: Record<CategoryId, string> = {
  general: 'settings-nav-general',
  team: 'settings-nav-team',
  billing: 'settings-nav-billing',
  integrations: 'settings-nav-integrations',
  notifications: 'settings-nav-notifications',
  advanced: 'settings-nav-advanced',
  portal: 'settings-nav-portal',
}

// Map legacy ?tab= values to new ?section= values for back-compat with saved bookmarks
const TAB_TO_SECTION: Record<string, CategoryId> = {
  general: 'general',
  team: 'team',
  invites: 'team',
  'access-requests': 'team',
  integrations: 'integrations',
  payments: 'billing',
  'new-facility': 'advanced',
  portal: 'portal',
}

export function SettingsClient({
  facility,
  connectedUsers,
  currentUserId,
  currentUserEmail,
  role,
  isMaster = false,
  pendingRequestsCount,
  adminEmail,
  qbInvoiceSyncEnabled,
  claimRequests,
  pendingClaimsCount,
}: SettingsClientProps) {
  const searchParams = useSearchParams()

  const isAdmin = role === 'admin'
  const isFacilityStaff = role === 'facility_staff'
  const isBookkeeper = role === 'bookkeeper'

  const isSuperAdmin = !!(
    process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
    currentUserEmail === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  )

  const visibleCategories: CategoryDef[] = useMemo(() => {
    const build = (id: CategoryId, badge?: number): CategoryDef => ({
      id,
      ...CATEGORY_META[id],
      badge,
    })
    if (isFacilityStaff) {
      return [build('general')]
    }
    if (isBookkeeper) {
      return [build('notifications')]
    }
    // admin (or normalized super_admin) — ordered by group
    return [
      build('general'),
      build('team', pendingRequestsCount),
      build('portal', pendingClaimsCount),
      build('billing'),
      build('integrations'),
      build('notifications'),
      build('advanced'),
    ]
  }, [isFacilityStaff, isBookkeeper, pendingRequestsCount, pendingClaimsCount])

  const defaultSection: CategoryId = visibleCategories[0]?.id ?? 'general'

  // Resolve initial section from ?section= or back-compat ?tab= or QB OAuth callback
  const resolveInitial = (): CategoryId => {
    const sectionParam = searchParams.get('section')
    const tabParam = searchParams.get('tab')
    const qbParam = searchParams.get('qb')
    if (qbParam) return 'billing'
    const candidate = sectionParam ?? (tabParam ? TAB_TO_SECTION[tabParam] : null)
    if (candidate && visibleCategories.some((c) => c.id === candidate)) return candidate as CategoryId
    return defaultSection
  }

  const [activeSection, setActiveSection] = useState<CategoryId>(resolveInitial)
  // Mobile drill-down: false = category list, true = content view
  const [mobileShowingContent, setMobileShowingContent] = useState(false)
  const [query, setQuery] = useState('')

  // Sync URL when section changes (mirror via shallow replace, no scroll jump)
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('section') !== activeSection) {
      url.searchParams.set('section', activeSection)
      url.searchParams.delete('tab')
      window.history.replaceState(null, '', url.toString())
    }
  }, [activeSection])

  function selectCategory(id: CategoryId) {
    setActiveSection(id)
    setMobileShowingContent(true)
  }

  const facilityCode = facility.facilityCode
  const activeDef = visibleCategories.find((c) => c.id === activeSection) ?? visibleCategories[0]
  const ActiveIcon = activeDef?.icon ?? Building2

  const showSearch = visibleCategories.length > 4
  const q = query.trim().toLowerCase()
  const filtered = q
    ? visibleCategories.filter(
        (c) => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
      )
    : visibleCategories
  const showGroups = visibleCategories.length > 1 && !q

  function renderNavButton(cat: CategoryDef) {
    const active = cat.id === activeSection
    const Icon = cat.icon
    return (
      <li key={cat.id}>
        <button
          onClick={() => selectCategory(cat.id)}
          data-tour={TOUR_SLUGS[cat.id]}
          className={cn(
            'group px-2.5 py-2 text-sm rounded-xl w-full text-left flex items-center gap-2.5 transition-colors duration-150',
            active
              ? 'bg-[#F9EFF2] text-[#8B2E4A] font-semibold'
              : 'text-stone-600 hover:bg-stone-50'
          )}
        >
          <Icon
            size={17}
            className={cn(
              'shrink-0 transition-colors',
              active ? 'text-[#8B2E4A]' : 'text-stone-400 group-hover:text-stone-500'
            )}
          />
          <span className="flex-1 min-w-0 truncate">{cat.label}</span>
          {cat.badge ? (
            <span
              className={cn(
                'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold',
                active ? 'bg-[#8B2E4A] text-white' : 'bg-amber-100 text-amber-800'
              )}
            >
              {cat.badge}
            </span>
          ) : null}
          {/* mobile-only chevron affordance */}
          <ChevronRight size={15} className="md:hidden shrink-0 text-stone-300" />
        </button>
      </li>
    )
  }

  return (
    <div className="page-enter max-w-5xl mx-auto px-4 py-8">
      <h1
        className="text-2xl font-normal text-stone-900 mb-1"
        style={{ fontFamily: "'DM Serif Display', serif" }}
      >
        Settings
      </h1>
      <p className="text-stone-500 text-sm mb-6 flex items-center gap-2">
        {facilityCode && (
          <span className="inline-flex items-center rounded-md bg-stone-100 text-stone-500 text-xs font-mono px-1.5 py-0.5">
            {facilityCode}
          </span>
        )}
        {facility.name}
      </p>

      <div className="md:flex md:gap-0">
        {/* Left rail (desktop) / category list (mobile) */}
        <nav
          className={cn(
            'md:w-60 md:shrink-0 md:border-r md:border-stone-100 md:pr-4',
            mobileShowingContent ? 'hidden md:block' : 'block'
          )}
        >
          {showSearch && (
            <div className="relative mb-3">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search settings…"
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#8B2E4A]/20 focus:border-[#8B2E4A]/50 focus:shadow-[0_0_0_3px_rgba(139,46,74,0.08)] transition-shadow"
              />
            </div>
          )}

          {showGroups ? (
            <div className="space-y-4">
              {GROUP_ORDER.map((g) => {
                const items = filtered.filter((c) => c.group === g)
                if (items.length === 0) return null
                return (
                  <div key={g}>
                    <p className="px-2.5 mb-1 text-[10.5px] font-semibold text-stone-400 uppercase tracking-wide">
                      {GROUP_LABELS[g]}
                    </p>
                    <ul className="space-y-0.5">{items.map(renderNavButton)}</ul>
                  </div>
                )
              })}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {filtered.length === 0 ? (
                <li className="px-2.5 py-3 text-sm text-stone-400">No matching settings.</li>
              ) : (
                filtered.map(renderNavButton)
              )}
            </ul>
          )}
        </nav>

        {/* Right pane (desktop) / content view (mobile) */}
        <div
          className={cn(
            'flex-1 min-w-0 md:pl-7 mt-4 md:mt-0',
            !mobileShowingContent && 'hidden md:block'
          )}
        >
          {/* Mobile back link */}
          <button
            onClick={() => setMobileShowingContent(false)}
            className="md:hidden text-sm text-stone-500 mb-4 flex items-center gap-1 hover:text-stone-700"
          >
            <span>←</span>
            <span>All settings</span>
          </button>

          {/* Section header — the "what is what" anchor, consistent across sections */}
          {activeDef && (
            <div className="flex items-start gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#F9EFF2] text-[#8B2E4A] flex items-center justify-center shrink-0">
                <ActiveIcon size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-stone-900 leading-tight">{activeDef.label}</h2>
                <p className="text-sm text-stone-500 mt-0.5">{activeDef.description}</p>
              </div>
            </div>
          )}

          {activeSection === 'general' && (
            <GeneralSection facility={facility} role={role} />
          )}
          {activeSection === 'team' && isAdmin && (
            <TeamSection
              connectedUsers={connectedUsers}
              currentUserId={currentUserId}
              isSuperAdmin={isSuperAdmin}
              facilityId={facility.id}
              facilityName={facility.name}
            />
          )}
          {activeSection === 'billing' && isAdmin && (
            <BillingSection facility={facility} qbInvoiceSyncEnabled={qbInvoiceSyncEnabled} />
          )}
          {activeSection === 'integrations' && isAdmin && (
            <IntegrationsSection facility={facility} />
          )}
          {activeSection === 'notifications' && (isAdmin || isBookkeeper) && (
            <NotificationsSection adminEmail={adminEmail} role={role} dailyDigestEnabled={facility.dailyDigestEnabled} />
          )}
          {activeSection === 'portal' && isAdmin && (
            <PortalSection facility={facility} claimRequests={claimRequests} />
          )}
          {activeSection === 'advanced' && isAdmin && (
            <AdvancedSection facility={facility} isMaster={isMaster} />
          )}
        </div>
      </div>

      {/* Sign out — always at bottom */}
      <div className="mt-10 pt-6 border-t border-stone-100">
        <button
          onClick={async () => {
            const supabase = createClient()
            await supabase.auth.signOut()
            window.location.href = '/login'
          }}
          className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 font-medium transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign out
        </button>
      </div>

    </div>
  )
}
