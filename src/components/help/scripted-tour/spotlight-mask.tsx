'use client'

import { useEffect, useRef, useState } from 'react'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface SpotlightMaskProps {
  targetRect: Rect | null
  padding?: number
  isAction?: boolean
  onClose: () => void
}

// Four dark panels around the spotlight cutout. The cutout itself has NO element
// over it, so real clicks reach the underlying button/field — this is what makes
// the tutorial interactive (an SVG <mask> would still capture pointer events over
// the "transparent" region). Mirrors the proven mobile-tour-overlay pattern.
export function SpotlightMask({ targetRect, padding = 8, isAction = false, onClose }: SpotlightMaskProps) {
  const [windowSize, setWindowSize] = useState({ w: 0, h: 0 })
  const rafRef = useRef<number>(0)

  useEffect(() => {
    function update() {
      setWindowSize({ w: window.innerWidth, h: window.innerHeight })
    }
    update()

    function scheduleUpdate() {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(update)
    }

    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
    }
  }, [])

  const { w, h } = windowSize
  if (!w || !h) return null

  // Cutout bounds (clamped to viewport). With no target, collapse to a 0×0 box
  // at center so the whole screen dims.
  const cx = targetRect ? Math.max(0, targetRect.x - padding) : w / 2
  const cy = targetRect ? Math.max(0, targetRect.y - padding) : h / 2
  const cw = targetRect ? Math.min(w - cx, targetRect.width + padding * 2) : 0
  const ch = targetRect ? Math.min(h - cy, targetRect.height + padding * 2) : 0

  // On info steps, clicking the dim panels dismisses the tour. On action steps we
  // suppress that so a stray click near the target doesn't abandon the tutorial.
  const panelClose = isAction ? undefined : onClose
  const panel: React.CSSProperties = {
    position: 'fixed',
    background: 'rgba(0,0,0,0.72)',
    zIndex: 9000,
    pointerEvents: 'auto',
    cursor: isAction ? 'default' : 'pointer',
    transition: 'all 0.18s ease',
  }

  return (
    <>
      {/* top */}
      <div style={{ ...panel, left: 0, top: 0, width: w, height: cy }} onClick={panelClose} />
      {/* bottom */}
      <div style={{ ...panel, left: 0, top: cy + ch, width: w, height: Math.max(0, h - cy - ch) }} onClick={panelClose} />
      {/* left */}
      <div style={{ ...panel, left: 0, top: cy, width: cx, height: ch }} onClick={panelClose} />
      {/* right */}
      <div style={{ ...panel, left: cx + cw, top: cy, width: Math.max(0, w - cx - cw), height: ch }} onClick={panelClose} />
    </>
  )
}
