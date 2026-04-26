'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export function DebugBadge() {
  const router = useRouter()
  const [debug, setDebug] = useState<{ role: string; facilityName: string } | null>(null)

  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)__debug_role=([^;]*)/)
    if (match) {
      try { setDebug(JSON.parse(decodeURIComponent(match[1]))) } catch { /* ignore */ }
    }
  }, [])

  if (!debug) return null

  const handleReset = async () => {
    await fetch('/api/debug/reset', { method: 'POST' })
    router.refresh()
  }

  return (
    <div
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}
      className="fixed right-4 z-50 flex items-center gap-2 bg-amber-400 text-amber-950 text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg"
    >
      <span>Debug: {debug.role} @ {debug.facilityName}</span>
      <button onClick={handleReset} className="hover:opacity-70 transition-opacity ml-1">×</button>
    </div>
  )
}
