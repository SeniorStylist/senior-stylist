'use client'
import { useEffect, useState } from 'react'

interface PendingSignupBadgeProps {
  role: string
}

export function PendingSignupBadge({ role }: PendingSignupBadgeProps) {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (role !== 'stylist') return
    fetch('/api/signup-sheet?countOnly=true')
      .then((r) => r.json())
      .then((j) => {
        if (typeof j.data?.count === 'number') setCount(j.data.count)
      })
      .catch(() => {})
  }, [role])

  if (role !== 'stylist' || !count) return null
  return (
    <span
      title={`${count} pending sign-up${count === 1 ? '' : 's'}`}
      className="ml-1 inline-flex items-center justify-center bg-[#8B2E4A] text-white text-[10px] font-bold rounded-full min-w-4 h-4 px-1"
    >
      {count}
    </span>
  )
}
