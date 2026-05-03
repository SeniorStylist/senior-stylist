'use client'
import { useEffect, useState } from 'react'

export function NeedsReviewBadge() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/super-admin/import-review/count')
      .then(r => r.json())
      .then(j => { if (typeof j.data?.count === 'number') setCount(j.data.count) })
      .catch(() => {})
  }, [])

  if (!count) return null
  return (
    <span
      title={`${count} import${count === 1 ? '' : 's'} need review`}
      className="ml-auto text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-950"
    >
      {count}
    </span>
  )
}
