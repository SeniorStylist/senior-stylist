'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type NavRole = 'admin' | 'super_admin' | 'facility_staff' | 'bookkeeper' | 'stylist' | 'viewer'

interface TopBarProps {
  facilityName?: string
  facilityCode?: string | null
  role?: NavRole | string
}

const TABS: { href: string; label: string; roles: NavRole[] }[] = [
  { href: '/dashboard', label: 'Calendar', roles: ['admin', 'facility_staff', 'stylist'] },
  { href: '/residents', label: 'Residents', roles: ['admin', 'facility_staff'] },
  { href: '/log', label: 'Daily Log', roles: ['admin', 'facility_staff', 'stylist', 'bookkeeper'] },
]

export function TopBar({ facilityName, facilityCode, role = 'admin' }: TopBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const visibleTabs = TABS.filter((t) => t.roles.includes(role as NavRole))

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <div className="hidden md:flex h-12 shrink-0 items-center gap-1 px-5 border-b border-stone-200 bg-white/80 backdrop-blur-sm relative">
      <nav className="flex items-center gap-1 h-full">
        {visibleTabs.map((tab) => {
          const active = isActive(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch={true}
              className={cn(
                'relative inline-flex items-center h-full px-3 text-sm font-medium transition-colors',
                active ? 'text-stone-900' : 'text-stone-500 hover:text-stone-800'
              )}
            >
              <span>{tab.label}</span>
              {active && (
                <span className="absolute left-2 right-2 -bottom-px h-[2px] bg-[#8B2E4A] rounded-full" />
              )}
            </Link>
          )
        })}
      </nav>
      <div className="flex-1" />
      {facilityName && (
        <span className="h-8 px-3 rounded-full border border-stone-200 bg-stone-50 text-xs font-medium text-stone-700 inline-flex items-center gap-1.5">
          {facilityCode && (
            <span className="inline-flex items-center rounded-md bg-white text-stone-500 font-mono px-1.5 py-0.5 text-[10px]">
              {facilityCode}
            </span>
          )}
          <span className="max-w-[220px] truncate">{facilityName}</span>
        </span>
      )}
      {role === 'admin' && (
        <Button variant="primary" size="sm" onClick={() => router.push('/dashboard?new=1')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Booking
        </Button>
      )}
    </div>
  )
}
