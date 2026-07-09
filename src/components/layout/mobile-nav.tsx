'use client'

// Phase 17 — mobile nav v2: up to 5 pinned tabs + an always-present "More"
// sheet holding the rest. Per-role defaults; the user can customize which
// destinations are pinned. Phase 19: picks sync to the server (user_prefs via
// /api/profile/nav-prefs) so they follow the user across devices; localStorage
// (ss_mobile_nav:{userId}) stays the instant-apply + offline layer.
// Tour contract: pinned tabs carry data-tour-mobile="nav-*"; unpinned
// destinations carry the SAME slug on their More-sheet row (only one instance
// is ever in the DOM at a time — the sheet renders only while open).

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { haptics } from '@/lib/haptics'
import { PendingSignupBadge } from '@/components/signup-sheet/pending-signup-badge'
import { BottomSheet } from '@/components/ui/bottom-sheet'

type NavRole = 'admin' | 'super_admin' | 'facility_staff' | 'bookkeeper' | 'stylist' | 'viewer'

interface NavItem {
  href: string
  label: string
  slug: string
  icon: React.ReactNode
  roles: NavRole[]
}

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Calendar',
    slug: 'nav-calendar',
    roles: ['admin', 'facility_staff', 'stylist'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
  },
  {
    href: '/log',
    label: 'Log',
    slug: 'nav-daily-log',
    roles: ['admin', 'facility_staff', 'stylist', 'bookkeeper'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <polyline points="10 9 9 9 8 9"/>
      </svg>
    ),
  },
  {
    href: '/my-account',
    label: 'Account',
    slug: 'nav-my-account',
    roles: ['stylist'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
  {
    href: '/signup-sheet',
    label: 'Sign-Ups',
    slug: 'nav-signup-sheet',
    roles: ['admin', 'facility_staff'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
        <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
        <line x1="12" y1="11" x2="16" y2="11"/>
        <line x1="12" y1="16" x2="16" y2="16"/>
        <line x1="8" y1="11" x2="8.01" y2="11"/>
        <line x1="8" y1="16" x2="8.01" y2="16"/>
      </svg>
    ),
  },
  {
    href: '/residents',
    label: 'Residents',
    slug: 'nav-residents',
    roles: ['admin', 'facility_staff'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 00-3-3.87"/>
        <path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
    ),
  },
  {
    href: '/analytics',
    label: 'Analytics',
    slug: 'nav-analytics',
    roles: ['admin', 'bookkeeper'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10"/>
        <line x1="12" y1="20" x2="12" y2="4"/>
        <line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    ),
  },
  {
    href: '/payroll',
    label: 'Payroll',
    slug: 'nav-payroll',
    roles: ['admin', 'bookkeeper'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <line x1="2" y1="10" x2="22" y2="10"/>
        <circle cx="8" cy="15" r="1.5"/>
      </svg>
    ),
  },
  {
    href: '/help',
    label: 'Help',
    slug: 'nav-help',
    roles: ['admin', 'super_admin', 'facility_staff', 'bookkeeper', 'stylist', 'viewer'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'Settings',
    slug: 'nav-settings',
    roles: ['admin', 'facility_staff', 'bookkeeper'],
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    ),
  },
]

const MAX_PINNED = 5

// Per-role default pinned tabs (hrefs, in display order).
const DEFAULT_PINNED: Record<string, string[]> = {
  admin: ['/dashboard', '/log', '/residents', '/analytics', '/payroll'],
  super_admin: ['/dashboard', '/log', '/residents', '/analytics', '/payroll'],
  facility_staff: ['/dashboard', '/log', '/signup-sheet', '/residents', '/settings'],
  stylist: ['/dashboard', '/log', '/my-account', '/help'],
  bookkeeper: ['/log', '/analytics', '/payroll', '/settings', '/help'],
  viewer: ['/help'],
}

function storageKey(userId: string | undefined, role: string) {
  return `ss_mobile_nav:${userId ?? 'anon'}:${role}`
}

function loadPinned(userId: string | undefined, role: string, available: NavItem[]): string[] {
  const fallback = (DEFAULT_PINNED[role] ?? DEFAULT_PINNED.admin).filter((href) =>
    available.some((i) => i.href === href),
  )
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(storageKey(userId, role))
    if (!raw) return fallback
    const saved: unknown = JSON.parse(raw)
    if (!Array.isArray(saved)) return fallback
    const valid = saved.filter(
      (h): h is string => typeof h === 'string' && available.some((i) => i.href === h),
    )
    return valid.length > 0 ? valid.slice(0, MAX_PINNED) : fallback
  } catch {
    return fallback
  }
}

interface MobileNavProps {
  role?: string
  debugMode?: boolean
  userId?: string
}

export function MobileNav({ role = 'admin', userId }: MobileNavProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  // Phase 24 escape hatch: a tapped tab optimistically highlights, but if the
  // soft navigation's RSC fetch hangs (slow server, flaky network) the page
  // never moves and the highlight lies. If the pathname hasn't changed 4s
  // after a tap, force a HARD navigation — it goes through the SW page cache,
  // so it even works offline for cached pages. Tabs must ALWAYS switch.
  const escapeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const armEscapeHatch = (href: string) => {
    if (escapeTimerRef.current) clearTimeout(escapeTimerRef.current)
    escapeTimerRef.current = setTimeout(() => {
      if (window.location.pathname !== href) window.location.assign(href)
    }, 4_000)
  }
  const [customizing, setCustomizing] = useState(false)
  const available = navItems.filter((item) => item.roles.includes(role as NavRole))
  // SSR renders the role default; the saved customization applies after mount
  // (lazy read would mismatch hydration since the server can't see localStorage).
  const [pinned, setPinned] = useState<string[]>(() =>
    (DEFAULT_PINNED[role] ?? DEFAULT_PINNED.admin).filter((href) => available.some((i) => i.href === href)),
  )

  useEffect(() => {
    setPinned(loadPinned(userId, role, available))
    // Phase 19 — server-synced prefs win over the device copy when present
    // (last save from ANY device). Offline: fetch fails silently, local stays.
    fetch('/api/profile/nav-prefs')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const server: unknown = j?.data?.mobileNav?.[role]
        if (!Array.isArray(server)) return
        const valid = server.filter(
          (h): h is string => typeof h === 'string' && available.some((i) => i.href === h),
        )
        if (valid.length > 0) {
          setPinned(valid.slice(0, MAX_PINNED))
          try {
            localStorage.setItem(storageKey(userId, role), JSON.stringify(valid.slice(0, MAX_PINNED)))
          } catch { /* ignore */ }
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, role])

  useEffect(() => {
    setPendingHref(null)
    setMoreOpen(false)
    if (escapeTimerRef.current) {
      clearTimeout(escapeTimerRef.current)
      escapeTimerRef.current = null
    }
  }, [pathname])

  useEffect(() => () => {
    if (escapeTimerRef.current) clearTimeout(escapeTimerRef.current)
  }, [])

  const pinnedItems = pinned
    .map((href) => available.find((i) => i.href === href))
    .filter((i): i is NavItem => !!i)
    .slice(0, MAX_PINNED)
  const overflowItems = available.filter((i) => !pinnedItems.some((p) => p.href === i.href))

  const savePinned = (next: string[]) => {
    setPinned(next)
    try {
      localStorage.setItem(storageKey(userId, role), JSON.stringify(next))
    } catch { /* private browsing */ }
    // Phase 19 — sync across devices; fire-and-forget (offline = device-local until next save)
    fetch('/api/profile/nav-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, hrefs: next }),
    }).catch(() => {})
  }

  const togglePin = (href: string) => {
    haptics.selection()
    if (pinned.includes(href)) {
      if (pinned.length <= 1) return // never allow zero tabs
      savePinned(pinned.filter((h) => h !== href))
    } else {
      if (pinned.length >= MAX_PINNED) return
      // Insert respecting canonical navItems order so tabs stay predictable
      const next = navItems
        .filter((i) => pinned.includes(i.href) || i.href === href)
        .map((i) => i.href)
      savePinned(next)
    }
  }

  const isActive = (href: string) =>
    pendingHref
      ? pendingHref === href
      : pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
  const moreActive = !pendingHref && overflowItems.some((i) => isActive(i.href))

  return (
    <>
      <nav
        aria-label="Main"
        className="mobile-nav fixed bottom-0 left-0 right-0 z-[60] flex border-t border-stone-200 bg-white md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {pinnedItems.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              onClick={() => { haptics.selection(); setPendingHref(item.href); armEscapeHatch(item.href) }}
              data-tour-mobile={item.slug}
              className={cn(
                'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-medium transition-all duration-75 active:scale-95 active:opacity-70 min-w-0',
                active ? 'text-[#8B2E4A]' : 'text-stone-400'
              )}
            >
              <span className="relative">
                {item.icon}
                {item.href === '/dashboard' && (
                  <span className="absolute -top-1 -right-2">
                    <PendingSignupBadge role={role} />
                  </span>
                )}
              </span>
              <span className="max-w-full truncate">{item.label}</span>
              {active && <span className="w-1 h-1 rounded-full bg-[#8B2E4A] mt-0.5 animate-in zoom-in-50 fade-in duration-200" />}
            </Link>
          )
        })}
        <button
          type="button"
          onClick={() => { haptics.selection(); setMoreOpen(true) }}
          data-tour-mobile="nav-more"
          aria-label="More"
          className={cn(
            'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-medium transition-all duration-75 active:scale-95 active:opacity-70 min-w-0',
            moreActive ? 'text-[#8B2E4A]' : 'text-stone-400'
          )}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
          </svg>
          <span className="max-w-full truncate">More</span>
          {moreActive && <span className="w-1 h-1 rounded-full bg-[#8B2E4A] mt-0.5 animate-in zoom-in-50 fade-in duration-200" />}
        </button>
      </nav>

      <BottomSheet isOpen={moreOpen} onClose={() => { setMoreOpen(false); setCustomizing(false) }} title={customizing ? 'Customize tabs' : 'More'}>
        <div className="px-5 pb-5">
          {!customizing ? (
            <>
              {overflowItems.length === 0 && (
                <p className="text-sm text-stone-400 py-2">Everything is pinned to your bar.</p>
              )}
              <div className="flex flex-col">
                {overflowItems.map((item) => (
                  <button
                    key={item.href}
                    type="button"
                    data-tour-mobile={item.slug}
                    onClick={() => {
                      haptics.selection()
                      setMoreOpen(false)
                      setPendingHref(item.href)
                      armEscapeHatch(item.href)
                      router.push(item.href)
                    }}
                    className={cn(
                      'flex items-center gap-3 py-3.5 px-1 text-left border-b border-stone-50 last:border-b-0',
                      isActive(item.href) ? 'text-[#8B2E4A]' : 'text-stone-700'
                    )}
                  >
                    <span className={isActive(item.href) ? 'text-[#8B2E4A]' : 'text-stone-400'}>{item.icon}</span>
                    <span className="text-sm font-medium">{item.label}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setCustomizing(true)}
                className="mt-3 w-full flex items-center justify-center gap-2 text-sm font-semibold text-[#8B2E4A] bg-[#F9EFF2] rounded-xl py-3"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
                Customize tabs
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-stone-500 mb-3">
                Pick up to {MAX_PINNED} tabs for your bottom bar. Everything else stays here under More.
              </p>
              <div className="flex flex-col">
                {available.map((item) => {
                  const isPinned = pinned.includes(item.href)
                  const disabled = !isPinned && pinned.length >= MAX_PINNED
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={() => togglePin(item.href)}
                      disabled={disabled}
                      className={cn(
                        'flex items-center gap-3 py-3 px-1 text-left border-b border-stone-50 last:border-b-0',
                        disabled && 'opacity-40'
                      )}
                    >
                      <span className={isPinned ? 'text-[#8B2E4A]' : 'text-stone-400'}>{item.icon}</span>
                      <span className="flex-1 text-sm font-medium text-stone-700">{item.label}</span>
                      <span
                        className={cn(
                          'w-5 h-5 rounded-md border flex items-center justify-center',
                          isPinned ? 'bg-[#8B2E4A] border-[#8B2E4A]' : 'border-stone-300 bg-white'
                        )}
                      >
                        {isPinned && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => {
                    savePinned((DEFAULT_PINNED[role] ?? DEFAULT_PINNED.admin).filter((href) => available.some((i) => i.href === href)))
                  }}
                  className="flex-1 text-sm font-semibold text-stone-600 bg-stone-100 rounded-xl py-3"
                >
                  Reset to default
                </button>
                <button
                  type="button"
                  onClick={() => setCustomizing(false)}
                  className="flex-1 text-sm font-semibold text-white bg-[#8B2E4A] rounded-xl py-3"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </BottomSheet>
    </>
  )
}
