'use client'

// Phase 12J — Mobile tour overlay.
//
// React portal renderer for the mobile tour engine in src/lib/help/mobile-tour.ts.
// Listens for help-mobile-tour-show / help-mobile-tour-hide CustomEvents and
// renders a four-panel dark overlay with a rounded spotlight cutout + a
// bottom sheet card with progress dots, title, description, and buttons.
//
// Mounted at (protected)/layout.tsx alongside <TourResumer />.

import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
// P31 — import from tour-dom (NOT tours.ts) so this always-mounted overlay
// doesn't drag the full tour catalog into the shared layout bundle.
import { resolveQuery, type TourStep } from '@/lib/help/tour-dom'

const SPOTLIGHT_PADDING = 8

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

type ShowDetail = {
  tourId: string
  stepIndex: number
  step: TourStep
  totalSteps: number
}

function dispatchAdvance(direction: 'next' | 'prev') {
  window.dispatchEvent(
    new CustomEvent('help-mobile-tour-advance', { detail: { direction } }),
  )
}

function dispatchClose() {
  window.dispatchEvent(new CustomEvent('help-mobile-tour-close'))
}

export function MobileTourOverlay() {
  const [step, setStep] = useState<TourStep | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [totalSteps, setTotalSteps] = useState(0)
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null)
  const [sheetMounted, setSheetMounted] = useState(false)
  // Lerped cutout geometry — RAF loop glides this toward the target rect so the
  // spotlight slides between steps instead of snapping (mirrors the scripted
  // spotlight-mask.tsx). Initialized collapsed at viewport center.
  const [animRect, setAnimRect] = useState({ cx: 0, cy: 0, cw: 0, ch: 0 })
  const animRef = useRef({ cx: 0, cy: 0, cw: 0, ch: 0 })
  const lerpRafRef = useRef<number>(0)
  const animInitRef = useRef(false)
  const isFirstShowRef = useRef(true)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const targetElRef = useRef<HTMLElement | null>(null)

  // Listen for show/hide events from the mobile tour engine.
  useEffect(() => {
    const onShow = (e: Event) => {
      const ce = e as CustomEvent<ShowDetail>
      const detail = ce.detail
      if (!detail) return
      setStep(detail.step)
      setStepIndex(detail.stepIndex)
      setTotalSteps(detail.totalSteps)

      // Resolve target & measure rect. If the new step has an element but
      // querySelector returns null at this exact instant (rare race with React
      // render), keep the previous rect rather than resetting — the engine
      // already verified the element exists via waitForElement, and the
      // resize/scroll listeners will refresh the rect on the next tick.
      if (detail.step.element) {
        const el = document.querySelector<HTMLElement>(resolveQuery(detail.step.element))
        if (el) {
          targetElRef.current = el
          setSpotlightRect(el.getBoundingClientRect())
        }
      } else {
        targetElRef.current = null
        setSpotlightRect(null)
      }

      // Animate sheet only on first show of a tour run, not on each step change.
      if (isFirstShowRef.current) {
        setSheetMounted(false)
        // next paint
        requestAnimationFrame(() => setSheetMounted(true))
        isFirstShowRef.current = false
      }
    }
    const onHide = () => {
      setStep(null)
      setSpotlightRect(null)
      targetElRef.current = null
      setSheetMounted(false)
      isFirstShowRef.current = true
    }
    window.addEventListener('help-mobile-tour-show', onShow)
    window.addEventListener('help-mobile-tour-hide', onHide)
    return () => {
      window.removeEventListener('help-mobile-tour-show', onShow)
      window.removeEventListener('help-mobile-tour-hide', onHide)
    }
  }, [])

  // Keep spotlight rect in sync with scroll/resize while a step is active.
  useEffect(() => {
    if (!step?.element) return
    const update = () => {
      const el = targetElRef.current
      if (el) setSpotlightRect(el.getBoundingClientRect())
    }
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step])

  // Lock body scroll while tour is visible
  useEffect(() => {
    if (!step) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [step])

  // Smooth-glide the cutout geometry toward the target rect each step.
  useEffect(() => {
    if (typeof window === 'undefined' || !step) return
    const w = window.innerWidth
    const h = window.innerHeight
    const hasSpot = !!spotlightRect

    const target = hasSpot
      ? {
          cx: Math.max(0, spotlightRect!.left - SPOTLIGHT_PADDING),
          cy: Math.max(0, spotlightRect!.top - SPOTLIGHT_PADDING),
          cw: spotlightRect!.width + SPOTLIGHT_PADDING * 2,
          ch: spotlightRect!.height + SPOTLIGHT_PADDING * 2,
        }
      : { cx: w / 2, cy: h / 2, cw: 0, ch: 0 }

    // First paint of a run: jump straight to the target (no glide from 0,0).
    if (!animInitRef.current) {
      animInitRef.current = true
      animRef.current = target
      setAnimRect({ ...target })
      return
    }

    let running = true
    const tick = () => {
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
      if (!done) lerpRafRef.current = requestAnimationFrame(tick)
    }
    lerpRafRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(lerpRafRef.current)
    }
  }, [spotlightRect, step])

  // Reset the glide initializer when a tour run ends so the next run jumps in.
  useEffect(() => {
    if (!step) animInitRef.current = false
  }, [step])

  if (!step || typeof document === 'undefined') return null

  const isLastStep = stepIndex === totalSteps - 1
  const isFirstStep = stepIndex === 0
  const title = step.mobileTitle ?? step.title
  const description = step.mobileDescription ?? step.description
  const hasSpotlight = !!spotlightRect

  // Lerped cutout geometry (RAF loop above glides these toward the target rect).
  const sx = animRect.cx
  const sy = animRect.cy
  const sw = animRect.cw
  const sh = animRect.ch

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current
    if (!start) return
    touchStartRef.current = null
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) <= 50 || Math.abs(dx) <= Math.abs(dy)) return
    if (dx < 0 && !step.isAction) dispatchAdvance('next')
    else if (dx > 0 && !isFirstStep) dispatchAdvance('prev')
  }

  return createPortal(
    <>
      <style>{`
        @keyframes mobile-tour-step-enter {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .mobile-tour-step-enter { animation: none !important; }
        }
      `}</style>

      {/* Four-panel overlay — geometry is JS-lerped above, so no CSS transition
          here (the RAF loop owns the motion). Collapses to full-coverage when the
          spotlight is 0×0 (no-element steps). */}
      {/* Top */}
      <div
        className="fixed bg-black/60 z-[200] pointer-events-auto"
        style={{ top: 0, left: 0, right: 0, height: sy }}
      />
      {/* Bottom */}
      <div
        className="fixed bg-black/60 z-[200] pointer-events-auto"
        style={{ top: sy + sh, left: 0, right: 0, bottom: 0 }}
      />
      {/* Left */}
      <div
        className="fixed bg-black/60 z-[200] pointer-events-auto"
        style={{ top: sy, left: 0, width: sx, height: sh }}
      />
      {/* Right */}
      <div
        className="fixed bg-black/60 z-[200] pointer-events-auto"
        style={{ top: sy, left: sx + sw, right: 0, height: sh }}
      />
      {/* Spotlight ring — premium burgundy glow (matches scripted spotlight-ring).
          Action steps get a bright white inner highlight + glow; info steps stay
          subtle. Invisible when sw/sh are 0. */}
      <div
        className={`fixed z-[201] rounded-2xl pointer-events-none${step.isAction && hasSpotlight ? ' mobile-tour-spotlight-pulse' : ''}`}
        style={{
          top: sy,
          left: sx,
          width: sw,
          height: sh,
          boxShadow: step.isAction && hasSpotlight
            ? '0 0 0 3px rgba(255,255,255,0.95), 0 0 0 7px rgba(139,46,74,0.75), 0 0 22px 6px rgba(139,46,74,0.45)'
            : '0 0 0 3px rgba(139,46,74,0.55)',
        }}
      />

      {/* Bottom sheet */}
      <div
        className="fixed left-0 right-0 z-[202] bg-stone-50 rounded-t-3xl px-6 pt-5 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] pointer-events-auto"
        style={{
          // Float above the bottom nav (help audit R2 — matches the scripted sheet);
          // --app-nav-clearance already includes the safe-area inset.
          bottom: 'var(--app-nav-clearance, 0px)',
          paddingBottom: '1.25rem',
          transform: sheetMounted ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)',
          maxHeight: '60vh',
          overflowY: 'auto',
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Handle bar */}
        <div className="w-16 h-1.5 bg-stone-300 rounded-full mx-auto mb-4" />

        {/* Close */}
        <button
          type="button"
          onClick={dispatchClose}
          aria-label="Close tour"
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-stone-400 hover:text-stone-600"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>

        {/* Step counter + progress dots + content */}
        <div style={{ minHeight: '220px' }}>
          <div className="flex items-center justify-center gap-2 mb-3">
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                className={`rounded-full transition-all duration-200 ${i === stepIndex ? 'w-3 h-3 bg-[#8B2E4A] scale-110' : 'w-3 h-3 bg-stone-200'}`}
              />
            ))}
          </div>

          {/* Per-step text — keyed so it crossfades on each step */}
          <div
            key={stepIndex}
            className="mobile-tour-step-enter"
            style={{ animation: 'mobile-tour-step-enter 0.14s ease both' }}
          >
            {/* Step counter */}
            <p className="text-xs text-stone-400 font-medium tracking-wide mb-1">
              Step {stepIndex + 1} of {totalSteps}
            </p>

            {/* Title with left accent bar */}
            <div className="flex items-start gap-3">
              <div className="w-1 h-7 bg-[#8B2E4A] rounded-full shrink-0 mt-0.5" />
              <h2 className="text-2xl font-bold text-stone-900 leading-tight">
                {title}
              </h2>
            </div>

            {/* Description */}
            <p className="text-[17px] text-stone-700 leading-relaxed mt-2">
              {description}
            </p>
          </div>

          {/* Buttons / action indicator */}
          {step.isAction ? (
            <div className="flex flex-col items-center gap-2 mt-4 mb-1">
              <div
                className="animate-bounce text-[#8B2E4A]"
                style={{
                  transform: spotlightRect && spotlightRect.top > window.innerHeight * 0.6
                    ? 'rotate(180deg)'
                    : undefined,
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </div>
              <span className="text-sm font-bold tracking-widest uppercase text-[#8B2E4A] px-4 py-1.5 bg-[#8B2E4A]/10 rounded-full border border-[#8B2E4A]/20">
                TAP HERE
              </span>
            </div>
          ) : (
            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => (isLastStep ? dispatchClose() : dispatchAdvance('next'))}
                className="min-h-[52px] w-full bg-[#8B2E4A] text-white rounded-2xl text-[17px] font-semibold shadow-[0_2px_8px_rgba(139,46,74,0.3)] active:scale-[0.98] transition-transform"
              >
                {isLastStep ? '✓ Done' : 'Next →'}
              </button>
              {!isFirstStep && (
                <button
                  type="button"
                  onClick={() => dispatchAdvance('prev')}
                  className="min-h-[52px] w-full bg-stone-100 text-stone-700 rounded-2xl text-[17px] font-semibold active:scale-[0.98] transition-transform"
                >
                  ← Back
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  )
}
