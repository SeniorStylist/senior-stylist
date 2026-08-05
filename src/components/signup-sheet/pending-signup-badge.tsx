'use client'
import { useEffect, useState } from 'react'

interface PendingSignupBadgeProps {
  role: string
  /**
   * P50 — which nav item hosts this badge: 'stylist' = the Calendar tab
   * (stylist-only, the original behavior), 'staff' = the Sign-Up Sheet item
   * (admin/facility_staff — the office triages family-portal requests).
   * A role only renders on its own mount, so no double-badging.
   */
  mount?: 'stylist' | 'staff'
}

const STAFF_ROLES = new Set(['admin', 'super_admin', 'facility_staff'])

export function PendingSignupBadge({ role, mount = 'stylist' }: PendingSignupBadgeProps) {
  const [count, setCount] = useState<number | null>(null)
  const eligible = mount === 'stylist' ? role === 'stylist' : STAFF_ROLES.has(role)

  useEffect(() => {
    if (!eligible) return
    fetch('/api/signup-sheet?countOnly=true')
      .then((r) => r.json())
      .then((j) => {
        if (typeof j.data?.count === 'number') setCount(j.data.count)
      })
      .catch(() => {})
  }, [eligible])

  if (!eligible || !count) return null
  return (
    <span
      title={`${count} pending sign-up${count === 1 ? '' : 's'}`}
      className="ml-1 inline-flex items-center justify-center bg-[#8B2E4A] text-white text-[10px] font-bold rounded-full min-w-4 h-4 px-1"
    >
      {count}
    </span>
  )
}
