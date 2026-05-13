// Phase 12J — Mobile tour engine.
//
// Renders TourStep[] as a four-panel dark overlay with a rounded spotlight
// cutout + a bottom sheet card. Shares the same TourStep data and the same
// sessionStorage resume mechanism as the desktop Driver.js path.
//
// The engine runs outside React. It dispatches CustomEvents that
// <MobileTourOverlay /> (mounted in the protected layout) listens for to
// render the UI. The overlay dispatches advance/close events back.

import {
  TOUR_DEFINITIONS,
  isOnRoute,
  resolveQuery,
  waitForElement,
  saveSessionState,
  clearSessionState,
  type TourDefinition,
} from './tours'
import { installTourFetchInterceptor } from './tour-fetch-interceptor'
import { setTourModeActive } from './tour-mode'
import { getTourRouter } from './tour-router'

// Mobile-specific tunables. Mobile waits less than desktop (5s feels broken
// on a phone) and uses a tighter resume TTL (1 min) to bound stale-state loops.
const MOBILE_ELEMENT_WAIT_MS = 2000
const SLOW_PAGE_WAIT_MS = 5000   // server-rendered pages with data fetching

function isSlowRoute(route: string): boolean {
  return (
    route.startsWith('/master-admin') ||
    route.startsWith('/stylists/directory') ||
    route.startsWith('/billing') ||
    route.startsWith('/analytics') ||
    route.startsWith('/payroll')
  )
}
const MOBILE_RESUME_TTL = 60_000
const SCROLL_SETTLE_MS = 50

let activeMobileTourId: string | null = null
let activeListenerCleanup: (() => void) | null = null
let activeAdvanceHandler: ((e: Event) => void) | null = null
let activeCloseHandler: ((e: Event) => void) | null = null

function destroyActiveMobileTour() {
  if (activeListenerCleanup) {
    activeListenerCleanup()
    activeListenerCleanup = null
  }
  if (activeAdvanceHandler) {
    window.removeEventListener('help-mobile-tour-advance', activeAdvanceHandler)
    activeAdvanceHandler = null
  }
  if (activeCloseHandler) {
    window.removeEventListener('help-mobile-tour-close', activeCloseHandler)
    activeCloseHandler = null
  }
  activeMobileTourId = null
}

function dispatchHide() {
  window.dispatchEvent(new CustomEvent('help-mobile-tour-hide'))
}

function isElementInViewport(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  return r.top >= 0 && r.bottom <= window.innerHeight
}

export async function startMobileTour(
  tourId: string,
  opts: { resumeFromStep?: number } = {},
): Promise<void> {
  if (typeof window === 'undefined') return
  const def = TOUR_DEFINITIONS[tourId]
  if (!def) {
    console.warn(`[help] No tour definition for "${tourId}"`)
    return
  }
  // Re-entry guard: if the same tour is already running (e.g. <TourResumer />
  // fires its effect twice in StrictMode or across a layout remount race),
  // skip the second call rather than starting a parallel run.
  if (activeMobileTourId === tourId) return
  // Phase 12O — engage demo-mode write interception for the duration of the tour
  installTourFetchInterceptor()
  setTourModeActive(true)
  // Wipe any lingering resume state at the START of a tour run. If we got here
  // via resumePendingTour the state was already consumed; if we got here via a
  // user-initiated launch from /help any stale state is moot. Cross-route hops
  // inside runMobileStep re-save state, so resume continues to work.
  clearSessionState()
  destroyActiveMobileTour()
  activeMobileTourId = tourId
  const startIndex = Math.max(0, opts.resumeFromStep ?? 0)
  await runMobileStep(def, startIndex)
}

async function runMobileStep(def: TourDefinition, index: number): Promise<void> {
  // Terminal step
  if (index >= def.steps.length) {
    destroyActiveMobileTour()
    clearSessionState()
    dispatchHide()
    setTourModeActive(false)
    // Fire AFTER setTourModeActive(false) so the Phase 12O fetch interceptor is off
    window.dispatchEvent(new CustomEvent('tour-completed', { detail: { tourId: def.id } }))
    fetch('/api/profile/complete-tour', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tourId: def.id }),
    }).catch(() => {})
    return
  }
  const step = def.steps[index]
  const totalSteps = def.steps.length

  // Cross-route hop: SPA nav via router.push when available; module state
  // survives across the transition. Falls back to hard-nav + sessionStorage
  // resume (with shorter mobile TTL) only when the router ref isn't set yet.
  if (!isOnRoute(step.route)) {
    destroyActiveMobileTour()
    dispatchHide()
    const router = getTourRouter()
    if (router) {
      router.push(step.route)
      // Fall through — waitForElement below picks up the new route's DOM.
    } else {
      saveSessionState({
        tourId: def.id,
        stepIndex: index,
        expiresAt: Date.now() + MOBILE_RESUME_TTL,
        mobile: true,
      })
      window.location.href = step.route
      return // Page reloads; <TourResumer /> resumes via startMobileTour.
    }
  }

  // Resolve element (or null for body-anchored info steps)
  let target: HTMLElement | null = null
  if (step.element) {
    const waitMs = isSlowRoute(step.route) ? SLOW_PAGE_WAIT_MS : MOBILE_ELEMENT_WAIT_MS
    target = await waitForElement(resolveQuery(step.element), waitMs)
    if (!target) {
      // Phase 12Y — silently skip when a target is missing. No user-facing toast.
      console.warn(`[mobile-tour] ${def.id}[${index}] target not found: ${step.element} — skipping`)
      return runMobileStep(def, index + 1)
    }
    // Only scroll + wait if the element is offscreen. When it's already visible,
    // dispatch immediately for a snappy step transition.
    if (!isElementInViewport(target)) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      await new Promise((r) => setTimeout(r, SCROLL_SETTLE_MS))
    }
  }

  // Tear down listeners from prior step before binding new ones
  destroyActiveMobileTour()

  // Tell the overlay to render this step
  window.dispatchEvent(
    new CustomEvent('help-mobile-tour-show', {
      detail: { tourId: def.id, stepIndex: index, step, totalSteps },
    }),
  )

  // Wire up close — same handler regardless of step type
  activeCloseHandler = () => {
    destroyActiveMobileTour()
    clearSessionState()
    dispatchHide()
    setTourModeActive(false)
  }
  window.addEventListener('help-mobile-tour-close', activeCloseHandler)

  if (step.isAction && target) {
    // Action step — advance only when the user clicks the highlighted element.
    // 50ms timeout lets React handle the click first (e.g. modal opens, nav fires).
    const onClick = () => {
      target!.removeEventListener('click', onClick, true)
      activeListenerCleanup = null
      setTimeout(() => {
        destroyActiveMobileTour()
        void runMobileStep(def, index + 1)
      }, 50)
    }
    target.addEventListener('click', onClick, true)
    activeListenerCleanup = () => target!.removeEventListener('click', onClick, true)
  } else {
    // Info step — wait for the overlay to dispatch advance from Next/Back/swipe.
    activeAdvanceHandler = (e: Event) => {
      const ce = e as CustomEvent<{ direction: 'next' | 'prev' }>
      const dir = ce.detail?.direction
      if (!dir) return
      const nextIndex = dir === 'next' ? index + 1 : index - 1
      if (nextIndex < 0) return
      destroyActiveMobileTour()
      void runMobileStep(def, nextIndex)
    }
    window.addEventListener('help-mobile-tour-advance', activeAdvanceHandler)
  }
}
