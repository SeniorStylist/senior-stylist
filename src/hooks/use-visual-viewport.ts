'use client'

// P39 — iOS keyboard/picker compensation for position:fixed sheets.
//
// When the on-screen keyboard (or a <select>/date wheel) opens, iOS shrinks
// the VISUAL viewport but leaves the LAYOUT viewport alone — and it may
// scroll/shift fixed layers to keep the focused field visible, then not fully
// restore them (the payroll "New Pay Period cut off at the top" screenshot).
// Nothing in the app compensated: zero visualViewport listeners existed.
//
// This hook returns the number of CSS pixels at the BOTTOM of the layout
// viewport currently occluded (keyboard height, roughly). Bottom-anchored
// sheets consume it as a `bottom` offset so they stay pinned to the visible
// area instead of drifting off-screen. 0 on desktop / when no keyboard.

import { useEffect, useState } from 'react'

export function useVisualViewportOcclusion(): number {
  const [occlusion, setOcclusion] = useState(0)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return

    const update = () => {
      // Height missing from the bottom = innerHeight − (visual height + top offset).
      const bottom = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      // Ignore sub-pixel/URL-bar jitter; only real keyboards (>50px) matter.
      setOcclusion(bottom > 50 ? bottom : 0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return occlusion
}
