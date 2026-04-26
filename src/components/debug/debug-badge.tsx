'use client'

import { useEffect, useState } from 'react'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  facility_staff: 'Facility Staff',
  bookkeeper: 'Bookkeeper',
  stylist: 'Stylist',
}

export function DebugBadge() {
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
    window.location.href = '/super-admin'
  }

  return (
    <div className="fixed top-4 right-4 z-[200] flex items-center gap-2 bg-amber-400 text-amber-950 text-xs font-bold px-3 py-2 rounded-2xl shadow-xl border-2 border-amber-500">
      <span className="text-amber-800 text-[10px] font-semibold uppercase tracking-wide">Debug</span>
      <span className="font-bold">
        {ROLE_LABEL[debug.role] ?? debug.role} · {debug.facilityName}
      </span>
      <button
        onClick={handleReset}
        className="ml-2 bg-amber-950/10 hover:bg-amber-950/20 text-amber-900 font-bold px-2 py-0.5 rounded-lg text-xs transition-colors"
      >
        ← Exit to Super Admin
      </button>
    </div>
  )
}
