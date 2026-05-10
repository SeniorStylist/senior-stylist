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
import { resolveQuery, type TourStep } from '@/lib/help/tours'

const SPOTLIGHT_PADDING = 8

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

      // Resolve target & measure rect
      if (detail.step.element) {
        const el = document.querySelector<HTMLElement>(resolveQuery(detail.step.element))
        targetElRef.current = el
        setSpotlightRect(el ? el.getBoundingClientRect() : null)
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

  if (!step || typeof document === 'undefined') return null

  const isLastStep = stepIndex === totalSteps - 1
  const isFirstStep = stepIndex === 0
  const title = step.mobileTitle ?? step.title
  const description = step.mobileDescription ?? step.description
  const hasSpotlight = !!spotlightRect

  // Spotlight rect with padding
  const sx = hasSpotlight ? Math.max(0, spotlightRect!.left - SPOTLIGHT_PADDING) : 0
  const sy = hasSpotlight ? Math.max(0, spotlightRect!.top - SPOTLIGHT_PADDING) : 0
  const sw = hasSpotlight ? spotlightRect!.width + SPOTLIGHT_PADDING * 2 : 0
  const sh = hasSpotlight ? spotlightRect!.height + SPOTLIGHT_PADDING * 2 : 0

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
      {/* Overlay layer(s) */}
      {hasSpotlight ? (
        <>
          {/* Top */}
          <div
            className="fixed bg-black/60 z-[200] pointer-events-auto transition-all duration-200 ease-out"
            style={{ top: 0, left: 0, right: 0, height: sy }}
          />
          {/* Bottom */}
          <div
            className="fixed bg-black/60 z-[200] pointer-events-auto transition-all duration-200 ease-out"
            style={{ top: sy + sh, left: 0, right: 0, bottom: 0 }}
          />
          {/* Left */}
          <div
            className="fixed bg-black/60 z-[200] pointer-events-auto transition-all duration-200 ease-out"
            style={{ top: sy, left: 0, width: sx, height: sh }}
          />
          {/* Right */}
          <div
            className="fixed bg-black/60 z-[200] pointer-events-auto transition-all duration-200 ease-out"
            style={{ top: sy, left: sx + sw, right: 0, height: sh }}
          />
          {/* Spotlight ring */}
          <div
            className={`fixed z-[201] rounded-2xl ring-4 ring-white/30 pointer-events-none transition-all duration-200 ease-out${step.isAction ? ' mobile-tour-spotlight-pulse' : ''}`}
            style={{ top: sy, left: sx, width: sw, height: sh }}
          />
        </>
      ) : (
        // No element — single full-screen overlay
        <div className="fixed inset-0 bg-black/60 z-[200] pointer-events-auto" />
      )}

      {/* Bottom sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[202] bg-white rounded-t-3xl px-6 pt-5 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] pointer-events-auto"
        style={{
          paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))',
          transform: sheetMounted ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)',
          maxHeight: '60vh',
          overflowY: 'auto',
        }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {/* Handle bar */}
        <div className="w-10 h-1 bg-stone-200 rounded-full mx-auto mb-4" />

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

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1 mb-3">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              className={`w-2 h-2 rounded-full ${i === stepIndex ? 'bg-[#8B2E4A]' : 'bg-stone-200'}`}
            />
          ))}
        </div>

        {/* Title */}
        <h2
          className="text-xl font-bold text-stone-900"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          {title}
        </h2>

        {/* Description */}
        <p className="text-[15px] text-stone-600 leading-relaxed mt-2">
          {description}
        </p>

        {/* Buttons */}
        {step.isAction ? (
          <p className="text-sm text-stone-400 italic text-center mt-5 mb-1">
            {step.actionHint ?? 'Tap the highlighted area to continue'}
          </p>
        ) : (
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => (isLastStep ? dispatchClose() : dispatchAdvance('next'))}
              className="min-h-[52px] w-full bg-[#8B2E4A] text-white rounded-2xl text-base font-semibold shadow-[0_2px_8px_rgba(139,46,74,0.3)] active:scale-[0.98] transition-transform"
            >
              {isLastStep ? '✓ Done' : 'Next →'}
            </button>
            {!isFirstStep && (
              <button
                type="button"
                onClick={() => dispatchAdvance('prev')}
                className="min-h-[52px] w-full bg-stone-100 text-stone-700 rounded-2xl text-base font-semibold active:scale-[0.98] transition-transform"
              >
                ← Back
              </button>
            )}
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}
