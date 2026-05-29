'use client'

import { useEffect, useRef } from 'react'
import { ScriptedStep } from '@/lib/help/scripted-tour-types'

interface ScriptedTourPopoverProps {
  step: ScriptedStep
  stepIndex: number
  totalSteps: number
  targetRect: DOMRect | null
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  popoverRef: React.RefObject<HTMLDivElement | null>
}

function computePosition(targetRect: DOMRect | null, popoverWidth: number, popoverHeight: number) {
  if (!targetRect) {
    return {
      left: Math.max(16, (window.innerWidth - popoverWidth) / 2),
      top: Math.max(16, (window.innerHeight - popoverHeight) / 2),
    }
  }

  const margin = 16
  const vw = window.innerWidth
  const vh = window.innerHeight

  // Try each side in priority order — pick the one with the most space
  const sides = [
    { side: 'right', left: targetRect.right + margin, top: targetRect.top },
    { side: 'left', left: targetRect.left - popoverWidth - margin, top: targetRect.top },
    { side: 'bottom', left: targetRect.left, top: targetRect.bottom + margin },
    { side: 'top', left: targetRect.left, top: targetRect.top - popoverHeight - margin },
  ]

  for (const { left, top } of sides) {
    const fitsRight = left + popoverWidth + margin <= vw
    const fitsLeft = left >= margin
    const fitsBottom = top + popoverHeight + margin <= vh
    const fitsTop = top >= margin
    if (fitsRight && fitsLeft && fitsBottom && fitsTop) {
      return { left, top }
    }
  }

  // Fallback: centered
  return {
    left: Math.max(margin, Math.min(vw - popoverWidth - margin, targetRect.right + margin)),
    top: Math.max(margin, Math.min(vh - popoverHeight - margin, targetRect.top)),
  }
}

export function ScriptedTourPopover({
  step,
  stepIndex,
  totalSteps,
  targetRect,
  onNext,
  onPrev,
  onClose,
  popoverRef,
}: ScriptedTourPopoverProps) {
  const posRef = useRef({ left: 0, top: 0 })
  const nextBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const el = popoverRef.current
    if (!el) return
    const pos = computePosition(targetRect, el.offsetWidth || 320, el.offsetHeight || 200)
    posRef.current = pos
    el.style.left = `${pos.left}px`
    el.style.top = `${pos.top}px`
  })

  // Focus the Next button when step changes so keyboard users can advance immediately
  useEffect(() => {
    const t = requestAnimationFrame(() => nextBtnRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [stepIndex])

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' || e.key === 'Enter') onNext()
      if (e.key === 'ArrowLeft') onPrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNext, onPrev, onClose])

  const isFirst = stepIndex === 0
  const isLast = stepIndex === totalSteps - 1

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Tutorial step ${stepIndex + 1} of ${totalSteps}`}
      aria-live="polite"
      style={{
        position: 'fixed',
        zIndex: 9010,
        width: 320,
        background: 'white',
        borderRadius: 18,
        boxShadow: '0 8px 48px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)',
        overflow: 'hidden',
        transition: 'left 0.15s ease, top 0.15s ease',
        outline: 'none',
      }}
      tabIndex={-1}
    >
      {/* Burgundy accent bar */}
      <div style={{ height: 4, background: '#8B2E4A', width: '100%' }} />

      <div style={{ padding: '16px 18px 18px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8B2E4A', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Step {stepIndex + 1} of {totalSteps}
          </span>
          <button
            aria-label="Close tutorial"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#a8a29e',
              padding: 2,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              lineHeight: 1,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Title */}
        <p style={{ fontSize: 15, fontWeight: 700, color: '#1c1917', margin: '0 0 8px', lineHeight: 1.35 }}>
          {step.title}
        </p>

        {/* Description */}
        <p style={{ fontSize: 14, color: '#57534e', margin: '0 0 18px', lineHeight: 1.6 }}>
          {step.description}
        </p>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 14 }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              style={{
                width: i === stepIndex ? 18 : 6,
                height: 6,
                borderRadius: 999,
                background: i === stepIndex ? '#8B2E4A' : '#e7e5e4',
                transition: 'width 0.2s ease, background 0.2s ease',
              }}
            />
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          {!isFirst && (
            <button
              aria-label="Previous step"
              onClick={onPrev}
              style={{
                flex: '0 0 auto',
                padding: '9px 14px',
                borderRadius: 10,
                border: '1.5px solid #e7e5e4',
                background: '#f5f5f4',
                color: '#78716c',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ← Back
            </button>
          )}
          <button
            ref={nextBtnRef}
            aria-label={isLast ? 'Complete tutorial' : 'Next step'}
            onClick={onNext}
            style={{
              flex: 1,
              padding: '9px 16px',
              borderRadius: 10,
              border: 'none',
              background: '#8B2E4A',
              color: 'white',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(139,46,74,0.25)',
            }}
          >
            {isLast ? '✓ Done' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}
