'use client'
import { useEffect, useState } from 'react'

// New-feedback count pill on the Master Admin sidebar link. Mirrors
// NeedsReviewBadge — fetch on mount, render nothing until count > 0.
export function FeedbackBadge() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/feedback/count')
      .then(r => r.json())
      .then(j => { if (typeof j.data?.count === 'number') setCount(j.data.count) })
      .catch(() => {})
  }, [])

  if (!count) return null
  return (
    <span
      title={`${count} new feedback submission${count === 1 ? '' : 's'}`}
      className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-300 text-[#1C0A12]"
    >
      {count}
    </span>
  )
}
