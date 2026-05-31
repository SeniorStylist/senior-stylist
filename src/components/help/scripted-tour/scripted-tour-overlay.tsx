'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type { ScriptedTour } from '@/lib/help/scripted-tour-types'
import { resolveQuery } from '@/lib/help/tours'

const SpotlightMask = dynamic(() => import('./spotlight-mask').then((m) => ({ default: m.SpotlightMask })), { ssr: false })
const SpotlightRing = dynamic(() => import('./spotlight-ring').then((m) => ({ default: m.SpotlightRing })), { ssr: false })
const TargetArrow = dynamic(() => import('./target-arrow').then((m) => ({ default: m.TargetArrow })), { ssr: false })
const ScriptedTourPopover = dynamic(() => import('./scripted-tour-popover').then((m) => ({ default: m.ScriptedTourPopover })), { ssr: false })
const ScriptedTourSheet = dynamic(() => import('./scripted-tour-sheet').then((m) => ({ default: m.ScriptedTourSheet })), { ssr: false })
const TutorialCelebration = dynamic(() => import('./tutorial-celebration').then((m) => ({ default: m.TutorialCelebration })), { ssr: false })

interface ActiveState {
  tourId: string
  stepIndex: number
}

export function ScriptedTourOverlay() {
  const [active, setActive] = useState<ActiveState | null>(null)
  const [tour, setTour] = useState<ScriptedTour | null>(null)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number>(0)

  // Register this component as the UI handler for the scripted tour engine
  useEffect(() => {
    import('@/lib/help/scripted-tour').then((m) => {
      m.registerScriptedTourUI((state) => {
        setActive(state)
        setTour(m.getActiveTour())
      })
    })
  }, [])

  // Detect mobile breakpoint
  useEffect(() => {
    function check() { setIsMobile(window.matchMedia('(max-width: 767px)').matches) }
    check()
    const mq = window.matchMedia('(max-width: 767px)')
    mq.addEventListener('change', check)
    return () => mq.removeEventListener('change', check)
  }, [])

  // Track target element rect whenever active step changes
  useEffect(() => {
    if (!active || !tour) { setTargetRect(null); return }
    const step = tour.steps[active.stepIndex]

    function updateRect() {
      if (!step?.selector) { setTargetRect(null); return }
      const el = document.querySelector(resolveQuery(step.selector))
      if (el) {
        const rect = el.getBoundingClientRect()
        setTargetRect(rect)
        // Auto-scroll if offscreen
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      } else {
        setTargetRect(null)
      }
    }

    function schedule() {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(updateRect)
    }

    updateRect()
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const interval = setInterval(schedule, 300)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      clearInterval(interval)
    }
  }, [active, tour])

  const handleNext = useCallback(() => {
    import('@/lib/help/scripted-tour').then((m) => m.advanceStep())
  }, [])

  const handlePrev = useCallback(() => {
    import('@/lib/help/scripted-tour').then((m) => m.retreatStep())
  }, [])

  const handleClose = useCallback(() => {
    import('@/lib/help/scripted-tour').then((m) => m.closeTour('abandoned'))
  }, [])

  // All hooks above this line — conditional rendering only below
  if (!active || !tour) return null

  const isCelebrating = active.stepIndex >= tour.steps.length
  const step = tour.steps[active.stepIndex]

  if (isCelebrating) {
    return (
      <TutorialCelebration
        tourTitle={tour.title}
        learnings={tour.learnings}
        onClose={handleClose}
      />
    )
  }

  if (!step) return null

  const popoverEl = isMobile ? sheetRef.current : popoverRef.current
  const isAction = step.type === 'click'

  return (
    <>
      <SpotlightMask
        targetRect={targetRect ? { x: targetRect.x, y: targetRect.y, width: targetRect.width, height: targetRect.height } : null}
        isAction={isAction}
        onClose={handleClose}
      />
      {targetRect && (
        <SpotlightRing
          targetRect={{ x: targetRect.x, y: targetRect.y, width: targetRect.width, height: targetRect.height }}
          isAction={isAction}
        />
      )}
      {targetRect && popoverEl && (
        <TargetArrow
          targetRect={{ x: targetRect.x, y: targetRect.y, width: targetRect.width, height: targetRect.height }}
          popoverEl={popoverEl}
          isAction={isAction}
        />
      )}
      {isMobile ? (
        <ScriptedTourSheet
          step={step}
          stepIndex={active.stepIndex}
          totalSteps={tour.steps.length}
          isAction={isAction}
          scenarioSummary={tour.scenarioSummary}
          onNext={handleNext}
          onPrev={handlePrev}
          onClose={handleClose}
          sheetRef={sheetRef}
        />
      ) : (
        <ScriptedTourPopover
          step={step}
          stepIndex={active.stepIndex}
          totalSteps={tour.steps.length}
          targetRect={targetRect}
          isAction={isAction}
          scenarioSummary={tour.scenarioSummary}
          onNext={handleNext}
          onPrev={handlePrev}
          onClose={handleClose}
          popoverRef={popoverRef}
        />
      )}
    </>
  )
}
