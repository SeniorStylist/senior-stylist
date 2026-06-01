'use client'

import { useEffect, useRef } from 'react'
import { ScriptedStep } from '@/lib/help/scripted-tour-types'

interface ScriptedTourPopoverProps {
  step: ScriptedStep
  stepIndex: number
  totalSteps: number
  targetRect: DOMRect | null
  isAction?: boolean
  isAutoFill?: boolean
  scenarioSummary?: string
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  popoverRef: React.RefObject<HTMLDivElement | null>
}

const POPOVER_WIDTH = 380

// Space-scored positioning: sort candidate sides by available clearance,
// respect step.placement hint by putting it first.
function computePosition(
  targetRect: DOMRect | null,
  popoverWidth: number,
  popoverHeight: number,
  hint?: string,
) {
  if (!targetRect) {
    return {
      left: Math.max(16, (window.innerWidth - popoverWidth) / 2),
      top: Math.max(16, (window.innerHeight - popoverHeight) / 2),
    }
  }

  const margin = 16
  const vw = window.innerWidth
  const vh = window.innerHeight

  const sides = [
    {
      side: 'right',
      left: targetRect.right + margin,
      top: Math.max(margin, Math.min(vh - popoverHeight - margin, targetRect.top)),
      space: vw - targetRect.right - margin,
    },
    {
      side: 'left',
      left: targetRect.left - popoverWidth - margin,
      top: Math.max(margin, Math.min(vh - popoverHeight - margin, targetRect.top)),
      space: targetRect.left - margin,
    },
    {
      side: 'bottom',
      left: Math.max(margin, Math.min(vw - popoverWidth - margin, targetRect.left)),
      top: targetRect.bottom + margin,
      space: vh - targetRect.bottom - margin,
    },
    {
      side: 'top',
      left: Math.max(margin, Math.min(vw - popoverWidth - margin, targetRect.left)),
      top: targetRect.top - popoverHeight - margin,
      space: targetRect.top - margin,
    },
  ]

  // If hint provided, move that side to front
  if (hint) {
    const idx = sides.findIndex((s) => s.side === hint)
    if (idx > 0) {
      const [matched] = sides.splice(idx, 1)
      sides.unshift(matched)
    }
  }

  // Sort by available space (descending), but keep hint at front
  const sorted = hint
    ? [sides[0], ...sides.slice(1).sort((a, b) => b.space - a.space)]
    : sides.sort((a, b) => b.space - a.space)

  for (const { left, top, space } of sorted) {
    if (space >= popoverHeight && left >= margin && left + popoverWidth + margin <= vw) {
      return {
        left: Math.max(margin, Math.min(vw - popoverWidth - margin, left)),
        top: Math.max(margin, Math.min(vh - popoverHeight - margin, top)),
      }
    }
  }

  // Fallback: centered
  return {
    left: Math.max(margin, (vw - popoverWidth) / 2),
    top: Math.max(margin, (vh - popoverHeight) / 2),
  }
}

export function ScriptedTourPopover({
  step,
  stepIndex,
  totalSteps,
  targetRect,
  isAction = false,
  isAutoFill = false,
  scenarioSummary,
  onNext,
  onPrev,
  onClose,
  popoverRef,
}: ScriptedTourPopoverProps) {
  const nextBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const el = popoverRef.current
    if (!el) return
    const pos = computePosition(targetRect, el.offsetWidth || POPOVER_WIDTH, el.offsetHeight || 200, step.placement)
    el.style.left = `${pos.left}px`
    el.style.top = `${pos.top}px`
  })

  useEffect(() => {
    const t = requestAnimationFrame(() => nextBtnRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [stepIndex])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (!isAction && !isAutoFill && (e.key === 'ArrowRight' || e.key === 'Enter')) onNext()
      if (!isAutoFill && e.key === 'ArrowLeft') onPrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNext, onPrev, onClose, isAction, isAutoFill])

  const isFirst = stepIndex === 0
  const isLast = stepIndex === totalSteps - 1

  return (
    <>
      <style>{`
        @keyframes scripted-popover-enter {
          from { opacity: 0; transform: translateY(4px) scale(0.96); }
          to   { opacity: 1; transform: translateY(0)  scale(1); }
        }
        @keyframes scripted-step-enter {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .scripted-popover-enter, .scripted-step-enter { animation: none !important; }
        }
        @keyframes scripted-popover-dot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-3px); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .scripted-popover-dot { animation: none !important; opacity: 0.7; }
        }
      `}</style>
      <div
        ref={popoverRef}
        className="scripted-popover-enter"
        role="dialog"
        aria-modal="false"
        aria-label={`Tutorial step ${stepIndex + 1} of ${totalSteps}`}
        aria-live="polite"
        style={{
          position: 'fixed',
          zIndex: 9010,
          width: POPOVER_WIDTH,
          background: 'white',
          borderRadius: 18,
          boxShadow: '0 8px 48px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)',
          overflow: 'hidden',
          outline: 'none',
          animation: 'scripted-popover-enter 0.18s ease both',
        }}
        tabIndex={-1}
      >
        {/* Burgundy accent bar */}
        <div style={{ height: 4, background: '#8B2E4A', width: '100%' }} />

        <div style={{ padding: '16px 18px 18px' }}>
          {/* Header row */}
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

          {/* Per-step content — keyed so it crossfades on each step */}
          <div
            key={stepIndex}
            className="scripted-step-enter"
            style={{ animation: 'scripted-step-enter 0.14s ease both' }}
          >
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

            {/* Title */}
            <p style={{ fontSize: 15, fontWeight: 700, color: '#1c1917', margin: '0 0 8px', lineHeight: 1.35 }}>
              {step.title}
            </p>

            {/* Description */}
            <p style={{ fontSize: 14, color: '#57534e', margin: '0 0 18px', lineHeight: 1.6 }}>
              {step.description}
            </p>
          </div>

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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {!isFirst && !isAutoFill && (
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
            {isAutoFill ? (
              <div
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 10,
                  background: '#FBEEF2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                }}
              >
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="scripted-popover-dot"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: '#8B2E4A',
                      animation: `scripted-popover-dot-bounce 1.2s ease-in-out ${i * 0.18}s infinite`,
                    }}
                  />
                ))}
              </div>
            ) : isAction ? (
              <div
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 10,
                  background: '#FBEEF2',
                  color: '#8B2E4A',
                  fontSize: 12.5,
                  fontWeight: 600,
                  textAlign: 'center',
                }}
              >
                👆 Click the highlighted spot to continue
              </div>
            ) : (
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
            )}
          </div>
        </div>
      </div>
    </>
  )
}
