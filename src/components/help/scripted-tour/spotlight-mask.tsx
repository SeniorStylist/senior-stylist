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
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function SpotlightMask({ targetRect, padding = 8 }: SpotlightMaskProps) {
  const [win, setWin] = useState({ w: 0, h: 0 })
  // Animated rect — starts collapsed at viewport center
  const [animRect, setAnimRect] = useState({ cx: 0, cy: 0, cw: 0, ch: 0 })
  const animRef = useRef({ cx: 0, cy: 0, cw: 0, ch: 0 })
  const rafRef = useRef<number>(0)
  const initializedRef = useRef(false)

  useEffect(() => {
    function update() {
      setWin({ w: window.innerWidth, h: window.innerHeight })
    }
    update()
    function schedule() {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(update)
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [])

  // Initialize collapsed at center on first mount
  useEffect(() => {
    if (!win.w || !win.h || initializedRef.current) return
    initializedRef.current = true
    const cx = win.w / 2
    const cy = win.h / 2
    animRef.current = { cx, cy, cw: 0, ch: 0 }
    setAnimRect({ cx, cy, cw: 0, ch: 0 })
  }, [win])

  // JS lerp RAF loop — smooth glide to target rect each step
  useEffect(() => {
    if (!win.w || !win.h) return

    const target = targetRect
      ? {
          cx: Math.max(0, targetRect.x - padding),
          cy: Math.max(0, targetRect.y - padding),
          cw: Math.min(win.w, targetRect.width + padding * 2),
          ch: Math.min(win.h, targetRect.height + padding * 2),
        }
      : { cx: win.w / 2, cy: win.h / 2, cw: 0, ch: 0 }

    let running = true

    function tick() {
      if (!running) return
      const cur = animRef.current
      const ncx = lerp(cur.cx, target.cx, 0.25)
      const ncy = lerp(cur.cy, target.cy, 0.25)
      const ncw = lerp(cur.cw, target.cw, 0.25)
      const nch = lerp(cur.ch, target.ch, 0.25)

      const done =
        Math.abs(ncx - target.cx) < 0.5 &&
        Math.abs(ncy - target.cy) < 0.5 &&
        Math.abs(ncw - target.cw) < 0.5 &&
        Math.abs(nch - target.ch) < 0.5

      const next = done ? target : { cx: ncx, cy: ncy, cw: ncw, ch: nch }
      animRef.current = next
      setAnimRect({ ...next })
      if (!done) rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [targetRect, padding, win])

  const { w, h } = win
  if (!w || !h) return null

  const { cx, cy, cw, ch } = animRect

  // Round the cutout to match the SpotlightRing exactly: small targets (nav
  // icons, the + FAB) become a circle/pill; large panels keep a soft 16px
  // radius. Without this the bright hole reads as a square sitting inside a
  // circular ring. The cutout shares the ring's 8px padding so the two edges
  // line up perfectly.
  const minDim = Math.min(cw, ch)
  const cutoutRadius = cw > 0 && ch > 0 ? (minDim <= 96 ? minDim / 2 : 16) : 0

  return (
    // Rounded cutout — a single box whose massive box-shadow dims everything
    // around it, leaving a bright rounded hole over the target. The WHOLE mask
    // is pointerEvents:none: it never blocks interaction, so the user can edit
    // inputs, tap dropdown options, and click the highlighted element directly
    // (the app sits below at its natural z-index and receives every event). The
    // tour advances only when the user clicks the step's target — guard rails,
    // not a cage. Only the explicit X in the sheet/popover closes the tour.
    <div
      style={{
        position: 'fixed',
        left: cx,
        top: cy,
        width: Math.max(0, cw),
        height: Math.max(0, ch),
        borderRadius: cutoutRadius,
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.68)',
        zIndex: 9000,
        pointerEvents: 'none',
      }}
    />
  )
}
