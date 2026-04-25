'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface Props {
  facilityCode: string
}

export function PortalNav({ facilityCode }: Props) {
  const pathname = usePathname()
  const base = `/family/${encodeURIComponent(facilityCode)}`

  const tabs = [
    { href: base, label: 'Home', icon: HomeIcon, exact: true },
    { href: `${base}/appointments`, label: 'Appts', icon: CalendarIcon },
    { href: `${base}/request`, label: 'Request', icon: PlusIcon },
    { href: `${base}/billing`, label: 'Billing', icon: ReceiptIcon },
    { href: `${base}/contact`, label: 'Contact', icon: PhoneIcon },
  ]

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-t border-stone-200"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="max-w-[640px] mx-auto grid grid-cols-5">
        {tabs.map((t) => {
          const isActive = t.exact ? pathname === t.href : pathname.startsWith(t.href)
          const Icon = t.icon
          return (
            <Link
              key={t.label}
              href={t.href}
              prefetch
              className={cn(
                'flex flex-col items-center justify-center gap-1 py-2.5 transition-colors duration-150',
                isActive ? 'text-[#8B2E4A]' : 'text-stone-500 hover:text-stone-800',
              )}
            >
              <Icon active={isActive} />
              <span className={cn('text-[10.5px]', isActive ? 'font-semibold' : 'font-medium')}>{t.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? '#8B2E4A' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5L12 3l9 6.5V20a2 2 0 01-2 2h-4v-7H9v7H5a2 2 0 01-2-2V9.5z" />
    </svg>
  )
}

function CalendarIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? '#8B2E4A' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </svg>
  )
}

function PlusIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#8B2E4A' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

function ReceiptIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? '#8B2E4A' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3h14v18l-3-2-3 2-3-2-3 2-2-2V3z" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="9" y1="12" x2="15" y2="12" />
    </svg>
  )
}

function PhoneIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={active ? '#8B2E4A' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.86.32 1.71.57 2.54a2 2 0 01-.45 2.11L8 9.79a16 16 0 006 6l1.42-1.23a2 2 0 012.11-.45c.83.25 1.68.44 2.54.57A2 2 0 0122 16.92z" />
    </svg>
  )
}
