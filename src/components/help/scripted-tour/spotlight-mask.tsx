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

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

export function SpotlightMask({ targetRect, padding = 8, isAction = false, onClose }: SpotlightMaskProps) {
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

  const panelClose = isAction ? undefined : onClose
  const panel: React.CSSProperties = {
    position: 'fixed',
    background: 'rgba(0,0,0,0.72)',
    zIndex: 9000,
    pointerEvents: 'auto',
    cursor: isAction ? 'default' : 'pointer',
  }

  return (
    <>
      {/* top */}
      <div style={{ ...panel, left: 0, top: 0, width: w, height: Math.max(0, cy) }} onClick={panelClose} />
      {/* bottom */}
      <div style={{ ...panel, left: 0, top: cy + ch, width: w, height: Math.max(0, h - cy - ch) }} onClick={panelClose} />
      {/* left */}
      <div style={{ ...panel, left: 0, top: cy, width: Math.max(0, cx), height: ch }} onClick={panelClose} />
      {/* right */}
      <div style={{ ...panel, left: cx + cw, top: cy, width: Math.max(0, w - cx - cw), height: ch }} onClick={panelClose} />
    </>
  )
}
