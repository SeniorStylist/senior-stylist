'use client'

import { useEffect, useRef, useState } from 'react'

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface ArrowGeometry {
  tip: { x: number; y: number }
  tail: { x: number; y: number }
  ctrl: { x: number; y: number }
  headAngle: number
}

function nearestEdgeMidpoint(fromCenter: { x: number; y: number }, rect: Rect): { x: number; y: number } {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const dx = fromCenter.x - cx
  const dy = fromCenter.y - cy

  const scaleX = rect.width / 2 / Math.abs(dx || 0.001)
  const scaleY = rect.height / 2 / Math.abs(dy || 0.001)
  const scale = Math.min(scaleX, scaleY)

  return { x: cx + dx * scale, y: cy + dy * scale }
}

function computeGeometry(targetRect: Rect, popoverRect: Rect, reducedMotion: boolean): ArrowGeometry {
  const targetCenter = {
    x: targetRect.x + targetRect.width / 2,
    y: targetRect.y + targetRect.height / 2,
  }
  const popoverCenter = {
    x: popoverRect.x + popoverRect.width / 2,
    y: popoverRect.y + popoverRect.height / 2,
  }

  // Arrow tip = nearest edge of TARGET toward popover center
  const tip = nearestEdgeMidpoint(popoverCenter, targetRect)
  // Arrow tail = nearest edge of POPOVER toward target center
  const tail = nearestEdgeMidpoint(targetCenter, popoverRect)

  // Midpoint control offset — perpendicular to the line for gentle curve
  const mx = (tip.x + tail.x) / 2
  const my = (tip.y + tail.y) / 2
  const lineLen = Math.hypot(tip.x - tail.x, tip.y - tail.y)
  const perpScale = reducedMotion ? 0 : Math.min(lineLen * 0.25, 60)
  const perpX = -(tip.y - tail.y) / (lineLen || 1)
  const perpY = (tip.x - tail.x) / (lineLen || 1)
  const ctrl = { x: mx + perpX * perpScale, y: my + perpY * perpScale }

  // Tangent at the tip for the arrowhead rotation
  // Derivative of quadratic bezier at t=0 is 2*(ctrl - tail)
  const tx = 2 * (ctrl.x - tail.x)
  const ty = 2 * (ctrl.y - tail.y)
  const headAngle = Math.atan2(ty, tx) * (180 / Math.PI)

  return { tip, tail, ctrl, headAngle }
}

interface TargetArrowProps {
  targetRect: Rect
  popoverEl: HTMLElement | null
}

export function TargetArrow({ targetRect, popoverEl }: TargetArrowProps) {
  const [geo, setGeo] = useState<ArrowGeometry | null>(null)
  const rafRef = useRef<number>(0)
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    function update() {
      if (!popoverEl) return
      const popoverRect = popoverEl.getBoundingClientRect()
      setGeo(computeGeometry(targetRect, popoverRect, reducedMotion))
    }

    function schedule() {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(update)
    }

    update()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [targetRect, popoverEl, reducedMotion])

  if (!geo) return null

  const { tip, tail, ctrl, headAngle } = geo
  const ARROWHEAD_SIZE = 8

  // Arrowhead points (pointing right along X axis, rotated to match tangent)
  const arrowPoints = [
    [0, 0],
    [-ARROWHEAD_SIZE, -ARROWHEAD_SIZE * 0.5],
    [-ARROWHEAD_SIZE, ARROWHEAD_SIZE * 0.5],
  ]
    .map(([x, y]) => {
      const rad = (headAngle * Math.PI) / 180
      return [
        tip.x + (x * Math.cos(rad) - (y ?? 0) * Math.sin(rad)),
        tip.y + ((x ?? 0) * Math.sin(rad) + (y ?? 0) * Math.cos(rad)),
      ]
    })
    .map((p) => p.join(','))
    .join(' ')

  return (
    <svg
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 9002,
        overflow: 'visible',
      }}
    >
      <path
        d={`M ${tail.x} ${tail.y} Q ${ctrl.x} ${ctrl.y} ${tip.x} ${tip.y}`}
        fill="none"
        stroke="#8B2E4A"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={reducedMotion ? 'none' : '6 3'}
        opacity="0.85"
      />
      <polygon points={arrowPoints} fill="#8B2E4A" opacity="0.9" />
    </svg>
  )
}
