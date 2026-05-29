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
  onClose: () => void
}

export function SpotlightMask({ targetRect, padding = 8, onClose }: SpotlightMaskProps) {
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

  const cutout = targetRect
    ? {
        x: Math.max(0, targetRect.x - padding),
        y: Math.max(0, targetRect.y - padding),
        width: targetRect.width + padding * 2,
        height: targetRect.height + padding * 2,
        rx: 10,
      }
    : null

  const maskId = 'scripted-tour-mask'

  return (
    <svg
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 9000,
        pointerEvents: 'none',
      }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <mask id={maskId}>
          <rect width={w} height={h} fill="white" />
          {cutout && (
            <rect
              x={cutout.x}
              y={cutout.y}
              width={cutout.width}
              height={cutout.height}
              rx={cutout.rx}
              fill="black"
            />
          )}
        </mask>
      </defs>
      {/* Backdrop — clicking it dismisses */}
      <rect
        width={w}
        height={h}
        fill="rgba(0,0,0,0.72)"
        mask={`url(#${maskId})`}
        style={{ pointerEvents: 'all', cursor: 'default' }}
        onClick={onClose}
      />
    </svg>
  )
}
