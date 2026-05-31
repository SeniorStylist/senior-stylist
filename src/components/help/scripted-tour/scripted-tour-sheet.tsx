'use client'

import { useEffect, useRef } from 'react'
import { ScriptedStep } from '@/lib/help/scripted-tour-types'

interface ScriptedTourSheetProps {
  step: ScriptedStep
  stepIndex: number
  totalSteps: number
  isAction?: boolean
  scenarioSummary?: string
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  sheetRef: React.RefObject<HTMLDivElement | null>
}

export function ScriptedTourSheet({
  step,
  stepIndex,
  totalSteps,
  isAction = false,
  scenarioSummary,
  onNext,
  onPrev,
  onClose,
  sheetRef,
}: ScriptedTourSheetProps) {
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  // Only animate on first mount — step transitions don't re-animate
  const hasEnteredRef = useRef(false)

  useEffect(() => {
    hasEnteredRef.current = true
  }, [])

  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    function onTouchStart(e: TouchEvent) {
      touchStartX.current = e.touches[0]?.clientX ?? 0
      touchStartY.current = e.touches[0]?.clientY ?? 0
    }
    function onTouchEnd(e: TouchEvent) {
      const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current
      const dy = (e.changedTouches[0]?.clientY ?? 0) - touchStartY.current
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) { if (!isAction) onNext() }
        else onPrev()
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [onNext, onPrev, sheetRef, isAction])

  const isFirst = stepIndex === 0
  const isLast = stepIndex === totalSteps - 1
  const enterAnimation = hasEnteredRef.current ? 'none' : 'scripted-sheet-enter 0.3s cubic-bezier(0.32,0.72,0,1)'

  return (
    <>
      <style>{`
        @keyframes scripted-sheet-enter {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .scripted-tour-sheet-enter { animation: none !important; }
        }
      `}</style>
      <div
        ref={sheetRef}
        className="scripted-tour-sheet-enter"
        role="dialog"
        aria-modal="false"
        aria-label={`Tutorial step ${stepIndex + 1} of ${totalSteps}`}
        aria-live="polite"
        style={{
          position: 'fixed',
          // Sit directly on top of the mobile bottom nav so the Next/Back
          // buttons clear it (otherwise the nav covers the first step's button)
          // AND any highlighted nav item stays visible below the sheet.
          bottom: 'var(--app-nav-clearance, 0px)',
          left: 0,
          right: 0,
          zIndex: 9010,
          background: 'white',
          borderRadius: '24px 24px 0 0',
          padding: '20px',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.14)',
          animation: enterAnimation,
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 999, background: '#e7e5e4', margin: '0 auto 16px' }} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#8B2E4A', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Step {stepIndex + 1} of {totalSteps}
          </span>
          <button
            aria-label="Close tutorial"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a8a29e', padding: 4 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Per-step content */}
        <div key={stepIndex}>
          {/* Scenario badge on step 0 */}
          {stepIndex === 0 && scenarioSummary && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              background: '#fef3c7',
              border: '1px solid #fde68a',
              borderRadius: 999,
              padding: '3px 10px',
              fontSize: 11.5,
              fontWeight: 600,
              color: '#92400e',
              marginBottom: 10,
            }}>
              🎯 Practice: {scenarioSummary}
            </div>
          )}

          <p style={{ fontSize: 17, fontWeight: 700, color: '#1c1917', margin: '0 0 8px', lineHeight: 1.35 }}>
            {step.title}
          </p>
          <p style={{ fontSize: 15, color: '#57534e', margin: '0 0 20px', lineHeight: 1.6 }}>
            {step.description}
          </p>
        </div>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 18 }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              style={{
                width: i === stepIndex ? 20 : 7,
                height: 7,
                borderRadius: 999,
                background: i === stepIndex ? '#8B2E4A' : '#e7e5e4',
                transition: 'width 0.2s ease, background 0.2s ease',
              }}
            />
          ))}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isAction ? (
            <div
              style={{
                minHeight: 52,
                borderRadius: 14,
                background: '#FBEEF2',
                color: '#8B2E4A',
                fontSize: 15,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: '0 12px',
              }}
            >
              👆 Tap the highlighted spot to continue
            </div>
          ) : (
            <button
              aria-label={isLast ? 'Complete tutorial' : 'Next step'}
              onClick={onNext}
              style={{
                minHeight: 52,
                borderRadius: 14,
                border: 'none',
                background: '#8B2E4A',
                color: 'white',
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 10px rgba(139,46,74,0.3)',
              }}
            >
              {isLast ? '✓ Done' : 'Next →'}
            </button>
          )}
          {!isFirst && (
            <button
              aria-label="Previous step"
              onClick={onPrev}
              style={{
                minHeight: 44,
                borderRadius: 14,
                border: '1.5px solid #e7e5e4',
                background: '#f5f5f4',
                color: '#78716c',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ← Back
            </button>
          )}
        </div>
      </div>
    </>
  )
}
