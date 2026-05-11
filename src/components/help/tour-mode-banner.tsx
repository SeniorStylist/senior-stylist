'use client'

import { useEffect, useState } from 'react'

/**
 * Phase 12O — Persistent banner pinned to the top of the viewport while a
 * guided tour is active. Listens to the `tour-mode-change` CustomEvent
 * dispatched by `setTourModeActive()`. Renders off-screen (translateY(-100%))
 * when inactive so the slide animation works without unmounting.
 */
export function TourModeBanner() {
  const [active, setActive] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ active: boolean }>).detail
      if (!detail) return
      setActive(detail.active)
    }
    window.addEventListener('tour-mode-change', handler)
    return () => window.removeEventListener('tour-mode-change', handler)
  }, [])

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[250] bg-[#8B2E4A]/90 backdrop-blur-sm py-1.5 px-4 flex items-center justify-center gap-2 transition-transform duration-200 ease-out"
      style={{
        transform: active ? 'translateY(0)' : 'translateY(-100%)',
        pointerEvents: active ? 'auto' : 'none',
      }}
      role="status"
      aria-live="polite"
      aria-hidden={!active}
    >
      <span className="text-white text-xs font-medium">
        🎓 Tutorial Mode — changes won&apos;t be saved
      </span>
    </div>
  )
}
