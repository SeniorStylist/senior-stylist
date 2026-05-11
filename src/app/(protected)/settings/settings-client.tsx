'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { PublicFacility } from '@/lib/sanitize'
import { createClient } from '@/lib/supabase/client'
import { GeneralSection } from './sections/general-section'
import { TeamSection, type ConnectedUser } from './sections/team-section'
import { BillingSection } from './sections/billing-section'
import { IntegrationsSection } from './sections/integrations-section'
import { NotificationsSection } from './sections/notifications-section'
import { AdvancedSection } from './sections/advanced-section'

interface SettingsClientProps {
  facility: PublicFacility
  connectedUsers: ConnectedUser[]
  currentUserId: string
  currentUserEmail: string | null
  role: string
  pendingRequestsCount: number
  adminEmail: string | null
  qbInvoiceSyncEnabled: boolean
}

type CategoryId = 'general' | 'team' | 'billing' | 'integrations' | 'notifications' | 'advanced'

interface CategoryDef {
  id: CategoryId
  label: string
  badge?: number
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
}

export function SettingsClient({
  facility,
  connectedUsers,
  currentUserId,
  currentUserEmail,
  role,
  pendingRequestsCount,
  adminEmail,
  qbInvoiceSyncEnabled,
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
    if (isFacilityStaff) {
      return [{ id: 'general', label: 'General' }]
    }
    if (isBookkeeper) {
      return [{ id: 'notifications', label: 'Notifications' }]
    }
    // admin (or normalized super_admin)
    return [
      { id: 'general', label: 'General' },
      { id: 'team', label: 'Team & Roles', badge: pendingRequestsCount },
      { id: 'billing', label: 'Billing & Payments' },
      { id: 'integrations', label: 'Integrations' },
      { id: 'notifications', label: 'Notifications' },
      { id: 'advanced', label: 'Advanced' },
    ]
  }, [isFacilityStaff, isBookkeeper, pendingRequestsCount])

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
  // Mobile drill-down: null = category list, set = content view
  const [mobileShowingContent, setMobileShowingContent] = useState(false)

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
            'md:w-56 md:shrink-0 md:border-r md:border-stone-100 md:pr-4 md:space-y-0.5',
            mobileShowingContent ? 'hidden md:block' : 'block'
          )}
        >
          <ul className="space-y-0.5">
            {visibleCategories.map((cat) => {
              const active = cat.id === activeSection
              return (
                <li key={cat.id}>
                  <button
                    onClick={() => selectCategory(cat.id)}
                    data-tour={TOUR_SLUGS[cat.id]}
                    className={cn(
                      'px-3 py-2 text-sm rounded-xl w-full text-left flex items-center justify-between transition-colors duration-150',
                      active
                        ? 'bg-stone-100 text-stone-900 font-semibold'
                        : 'text-stone-600 hover:bg-stone-50'
                    )}
                  >
                    <span>{cat.label}</span>
                    {cat.badge ? (
                      <span
                        className={cn(
                          'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold',
                          active
                            ? 'bg-[#8B2E4A] text-white'
                            : 'bg-amber-100 text-amber-800'
                        )}
                      >
                        {cat.badge}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Right pane (desktop) / content view (mobile) */}
        <div
          className={cn(
            'flex-1 min-w-0 md:pl-6 mt-4 md:mt-0',
            !mobileShowingContent && 'hidden md:block'
          )}
        >
          {/* Mobile back link */}
          <button
            onClick={() => setMobileShowingContent(false)}
            className="md:hidden text-sm text-stone-500 mb-4 flex items-center gap-1 hover:text-stone-700"
          >
            <span>←</span>
            <span>Back to Settings</span>
          </button>

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
            <NotificationsSection adminEmail={adminEmail} role={role} />
          )}
          {activeSection === 'advanced' && isAdmin && (
            <AdvancedSection facility={facility} />
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
