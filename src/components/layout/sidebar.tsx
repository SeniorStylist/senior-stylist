'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'
import { NeedsReviewBadge } from '@/components/layout/needs-review-badge'
import { PendingSignupBadge } from '@/components/signup-sheet/pending-signup-badge'

type NavRole = 'admin' | 'super_admin' | 'facility_staff' | 'bookkeeper' | 'stylist' | 'viewer'

type NavItem = { href: string; label: string; icon: React.ReactNode; roles: NavRole[] }

const SettingsIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
)

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: 'Scheduling',
    items: [
      {
        href: '/dashboard',
        label: 'Calendar',
        roles: ['admin', 'facility_staff', 'stylist'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
        ),
      },
      {
        href: '/residents',
        label: 'Residents',
        roles: ['admin', 'facility_staff'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87"/>
            <path d="M16 3.13a4 4 0 010 7.75"/>
          </svg>
        ),
      },
      {
        href: '/log',
        label: 'Daily Log',
        roles: ['admin', 'facility_staff', 'stylist', 'bookkeeper'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Management',
    items: [
      {
        href: '/stylists',
        label: 'Stylists',
        roles: ['admin'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
        ),
      },
      {
        href: '/stylists/directory',
        label: 'Directory',
        roles: ['admin'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87"/>
            <path d="M16 3.13a4 4 0 010 7.75"/>
          </svg>
        ),
      },
      {
        href: '/services',
        label: 'Services',
        roles: ['admin'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="6" x2="21" y2="6"/>
            <line x1="8" y1="12" x2="21" y2="12"/>
            <line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/>
            <line x1="3" y1="12" x2="3.01" y2="12"/>
            <line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Financial',
    items: [
      {
        href: '/billing',
        label: 'Billing',
        roles: ['admin', 'bookkeeper'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <path d="M12 11v6"/>
            <path d="M9.5 13.5h4a1.5 1.5 0 010 3h-4"/>
          </svg>
        ),
      },
      {
        href: '/analytics',
        label: 'Analytics',
        roles: ['admin', 'bookkeeper'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
        ),
      },
      {
        href: '/payroll',
        label: 'Payroll',
        roles: ['admin', 'bookkeeper'],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="5" width="20" height="14" rx="2"/>
            <line x1="2" y1="10" x2="22" y2="10"/>
            <circle cx="8" cy="15" r="1.5"/>
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Account',
    items: [
      {
        href: '/my-account',
        label: 'My Account',
        roles: ['stylist'] as NavRole[],
        icon: (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        ),
      },
    ],
  },
]

const SETTINGS_ROLES: NavRole[] = ['admin', 'facility_staff', 'bookkeeper']

interface FacilityOption {
  id: string
  name: string
  facilityCode?: string | null
  role: string
}

interface SidebarProps {
  user: User
  facilityName?: string
  facilityCode?: string | null
  allFacilities?: FacilityOption[]
  role?: string
  debugMode?: boolean
}

export function Sidebar({ user, facilityName, facilityCode, allFacilities = [], role = 'admin', debugMode = false }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [facilitySearch, setFacilitySearch] = useState('')
  const [facilitySortOrder, setFacilitySortOrder] = useState<'fid' | 'name'>(() => {
    if (typeof window === 'undefined') return 'fid'
    return (localStorage.getItem('facilitySortOrder') as 'fid' | 'name') ?? 'fid'
  })
  const sortedFacilities = useMemo(() => {
    return [...allFacilities].sort((a, b) => {
      if (facilitySortOrder === 'name') return (a.name ?? '').localeCompare(b.name ?? '')
      const numA = parseInt(a.facilityCode?.replace(/\D/g, '') ?? '9999', 10)
      const numB = parseInt(b.facilityCode?.replace(/\D/g, '') ?? '9999', 10)
      return numA - numB
    })
  }, [allFacilities, facilitySortOrder])
  const filteredSwitcherFacilities = useMemo(() => {
    const q = facilitySearch.trim().toLowerCase()
    if (!q) return sortedFacilities
    return sortedFacilities.filter(
      (f) => f.name?.toLowerCase().includes(q) || f.facilityCode?.toLowerCase().includes(q)
    )
  }, [sortedFacilities, facilitySearch])
  const handleSortChange = (order: 'fid' | 'name') => {
    setFacilitySortOrder(order)
    localStorage.setItem('facilitySortOrder', order)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleSelectFacility = async (facilityId: string) => {
    setSwitching(true)
    setSwitcherOpen(false)
    setFacilitySearch('')
    await fetch('/api/facilities/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilityId }),
    })
    router.refresh()
    setSwitching(false)
  }

  const userInitials = user.user_metadata?.full_name
    ? user.user_metadata.full_name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()
    : user.email?.slice(0, 2).toUpperCase() ?? '??'

  const showSwitcher = allFacilities.length > 1 && role === 'admin'

  return (
    <aside
      className="w-[220px] shrink-0 flex flex-col h-screen sticky top-0 relative overflow-hidden"
      style={{ backgroundColor: 'var(--color-sidebar)' }}
    >
      {/* Radial accent overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(1200px 400px at -10% 0%, rgba(196,104,122,0.14), transparent 60%)' }}
      />
      <div className="relative flex flex-col h-full">
      {/* Logo / Facility name */}
      <div className="px-5 py-5 border-b border-white/10">
        <Link href="/dashboard" className="block">
          <Image src="/seniorstylistlogo.jpg" alt="Senior Stylist" width={160} height={64} style={{ filter: 'brightness(0) invert(1)' }} />
        </Link>
        {facilityName && !showSwitcher && (
          <div className="flex items-center mt-1 px-1">
            {facilityCode && (
              <span className="inline-flex items-center rounded-md bg-white/10 text-white/50 text-xs font-mono px-1.5 py-0.5 mr-1.5 shrink-0">
                {facilityCode}
              </span>
            )}
            <div className="text-xs leading-tight truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {facilityName}
            </div>
          </div>
        )}
        {debugMode && (
          <div className="mt-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-[10px] font-semibold text-center">
            DEBUG MODE
          </div>
        )}

        {/* Facility switcher */}
        {showSwitcher && (
          <div className="relative mt-3">
            <button
              onClick={() => setSwitcherOpen((o) => !o)}
              disabled={switching}
              className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}
            >
              <span className="flex items-center gap-1.5 min-w-0 truncate">
                {facilityCode && (
                  <span className="inline-flex items-center rounded-md bg-white/10 text-white/50 text-xs font-mono px-1.5 py-0.5 shrink-0">
                    {facilityCode}
                  </span>
                )}
                <span className="truncate">{facilityName ?? 'Select facility'}</span>
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {switcherOpen && (
              <div
                className="absolute top-full left-0 right-0 mt-1 rounded-lg shadow-lg z-50 overflow-hidden"
                style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/10">
                  <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>Sort:</span>
                  {(['fid', 'name'] as const).map((opt) => (
                    <button
                      key={opt}
                      onClick={() => handleSortChange(opt)}
                      className="px-2 py-0.5 rounded-full text-[10px] transition-colors"
                      style={{
                        backgroundColor: facilitySortOrder === opt ? 'rgba(255,255,255,0.15)' : 'transparent',
                        color: facilitySortOrder === opt ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
                        fontWeight: facilitySortOrder === opt ? '600' : '400',
                      }}
                    >
                      {opt === 'fid' ? 'FID' : 'A–Z'}
                    </button>
                  ))}
                </div>
                <div className="px-2 py-1.5 border-b border-white/10">
                  <input
                    type="text"
                    value={facilitySearch}
                    onChange={(e) => setFacilitySearch(e.target.value)}
                    placeholder="Search…"
                    className="w-full rounded-lg px-2.5 py-1.5 text-xs placeholder:text-white/40 focus:outline-none transition-colors"
                    style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)' }}
                  />
                </div>
              <div className="max-h-[60vh] overflow-y-auto">
                  {filteredSwitcherFacilities.length === 0 ? (
                    <p className="px-3 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>No facilities found</p>
                  ) : filteredSwitcherFacilities.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => handleSelectFacility(f.id)}
                      className="w-full text-left px-3 py-2 text-xs transition-colors"
                      style={{ color: f.name === facilityName ? '#C4687A' : 'rgba(255,255,255,0.7)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <div className="flex items-center gap-1.5">
                        {f.facilityCode && (
                          <span className="inline-flex items-center rounded-md bg-white/10 text-white/50 text-xs font-mono px-1.5 py-0.5 shrink-0">
                            {f.facilityCode}
                          </span>
                        )}
                        <span className="truncate">{f.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="border-t border-white/10 px-3 py-2">
                  <Link
                    href="/settings?section=advanced"
                    onClick={() => setSwitcherOpen(false)}
                    className="text-xs"
                    style={{ color: '#C4687A' }}
                  >
                    + Add facility
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
        {role === 'admin' && !showSwitcher && allFacilities.length <= 1 && (
          <div className="mt-3">
            <Link
              href="/settings?section=advanced"
              className="text-xs"
              style={{ color: 'rgba(196,104,122,0.6)' }}
            >
              + Add facility
            </Link>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 min-h-0 px-3 py-3 overflow-y-auto">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter((item) => item.roles.includes(role as NavRole))
          if (visibleItems.length === 0) return null
          return (
            <div key={group.label} className="mb-4 last:mb-0">
              <div className="text-[10px] tracking-[0.14em] uppercase text-white/35 px-4 mt-3 mb-2 font-medium">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const isActive =
                    item.href === '/stylists'
                      ? pathname === '/stylists' || (pathname.startsWith('/stylists/') && !pathname.startsWith('/stylists/directory'))
                      : pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
                  const tourSlug =
                    item.href === '/dashboard' ? 'nav-calendar' :
                    item.href === '/log' ? 'nav-daily-log' :
                    item.href === '/residents' ? 'nav-residents' :
                    item.href === '/billing' ? 'nav-billing' :
                    item.href === '/analytics' ? 'nav-analytics' :
                    item.href === '/payroll' ? 'nav-payroll' :
                    item.href === '/stylists' ? 'nav-stylists' :
                    item.href === '/my-account' ? 'nav-my-account' :
                    undefined
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={true}
                      data-tour={tourSlug}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors duration-150 ease-out',
                        isActive
                          ? 'bg-[#8B2E4A]/30 text-white font-semibold shadow-inner'
                          : 'text-white/70 font-medium hover:bg-white/5 hover:text-white/90'
                      )}
                    >
                      <span className={cn('transition-colors duration-150', isActive ? 'text-[#E8A0B0]' : 'text-white/50')}>
                        {item.icon}
                      </span>
                      <span className="flex-1">{item.label}</span>
                      {item.href === '/dashboard' && <PendingSignupBadge role={role} />}
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Help + Settings + Master Admin block — divider above, always last */}
      <div className="px-3 pb-2">
        <div className="border-t border-white/10 mx-1 mb-2" />
        <Link
          href="/help"
          prefetch={true}
          data-tour="nav-help"
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors duration-150 ease-out',
            pathname === '/help' || pathname.startsWith('/help/')
              ? 'bg-[#8B2E4A]/30 text-white font-semibold shadow-inner'
              : 'text-white/70 font-medium hover:bg-white/5 hover:text-white/90'
          )}
        >
          <span className={cn('transition-colors duration-150', pathname === '/help' || pathname.startsWith('/help/') ? 'text-[#E8A0B0]' : 'text-white/50')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </span>
          Help
        </Link>
        {SETTINGS_ROLES.includes(role as NavRole) && (
          <Link
            href="/settings"
            prefetch={true}
            data-tour="nav-settings"
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors duration-150 ease-out',
              pathname === '/settings' || pathname.startsWith('/settings/')
                ? 'bg-[#8B2E4A]/30 text-white font-semibold shadow-inner'
                : 'text-white/70 font-medium hover:bg-white/5 hover:text-white/90'
            )}
          >
            <span className={cn('transition-colors duration-150', pathname === '/settings' || pathname.startsWith('/settings/') ? 'text-[#E8A0B0]' : 'text-white/50')}>
              {SettingsIcon}
            </span>
            Settings
          </Link>
        )}
          {process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && !debugMode && (
            <Link
              href="/master-admin"
              prefetch={true}
              data-tour="nav-master-admin"
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150',
                pathname === '/master-admin'
                  ? 'bg-[#8B2E4A]/30 text-white font-semibold shadow-inner'
                  : 'text-white/70 font-medium hover:bg-white/5 hover:text-white/90'
              )}
            >
              <span className={cn(pathname === '/master-admin' ? 'text-[#E8A0B0]' : 'text-white/50')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                </svg>
              </span>
              Master Admin
              <NeedsReviewBadge />
            </Link>
          )}
      </div>

      {/* User */}
      <div className="px-3 py-4 border-t border-white/10">
        {role === 'viewer' && (
          <div className="mx-3 mb-2 px-2 py-1 rounded-lg text-center text-[10px] font-semibold tracking-wide"
            style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>
            View Only
          </div>
        )}
        <div className="flex items-center gap-3 px-3 py-2 rounded-xl" data-tour="sidebar-avatar">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
            style={{ backgroundColor: 'rgba(139, 46, 74, 0.2)', color: '#C4687A' }}
          >
            {userInitials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-white truncate">
              {user.user_metadata?.full_name ?? user.email}
            </div>
            <div className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {user.email}
            </div>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="mt-1 w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150"
          style={{ color: 'rgba(255,255,255,0.4)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.8)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          Sign out
        </button>
        <div className="mt-3 flex items-center justify-center gap-3 px-3">
          <a
            href="/privacy"
            className="text-xs transition-colors"
            style={{ color: 'rgba(255,255,255,0.25)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}
          >
            Privacy
          </a>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.15)' }}>·</span>
          <a
            href="/terms"
            className="text-xs transition-colors"
            style={{ color: 'rgba(255,255,255,0.25)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}
          >
            Terms
          </a>
        </div>
      </div>
      </div>
    </aside>
  )
}
