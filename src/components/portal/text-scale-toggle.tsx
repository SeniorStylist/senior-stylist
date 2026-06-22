'use client'

import { useState, useEffect } from 'react'

const SCALES = [1, 1.25, 1.5] as const
const LABELS = ['A', 'A+', 'A++'] as const
const STORAGE_KEY = 'portalTextScale'

/**
 * A/A+/A++ text-size toggle for the family portal.
 * Writes --portal-text-scale to :root and persists in localStorage.
 * Scoped to /family/* — safe to use document root since portal is a separate nav flow.
 */
export function TextScaleToggle() {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    // SSR-guarded: read saved preference on mount
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const num = parseFloat(stored)
        const i = (SCALES as readonly number[]).indexOf(num)
        if (i !== -1) {
          setIdx(i)
          document.documentElement.style.setProperty('--portal-text-scale', String(num))
        }
      }
    } catch { /* private browsing or SSR */ }
  }, [])

  const cycle = () => {
    setIdx((prev) => {
      const next = (prev + 1) % SCALES.length
      const scale = SCALES[next]
      document.documentElement.style.setProperty('--portal-text-scale', String(scale))
      try { localStorage.setItem(STORAGE_KEY, String(scale)) } catch { /* ignore */ }
      return next
    })
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="text-xs font-bold text-white/85 hover:text-white px-2 py-1 rounded-full border border-white/20 hover:bg-white/10 transition-colors min-w-[32px]"
      aria-label="Adjust text size"
      title="Adjust text size"
    >
      {LABELS[idx]}
    </button>
  )
}
