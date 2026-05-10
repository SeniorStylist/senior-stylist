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
  ELEMENT_WAIT_MS,
  SESSION_TTL_MS,
  isOnRoute,
  resolveQuery,
  waitForElement,
  saveSessionState,
  clearSessionState,
  toastWarning,
  type TourDefinition,
} from './tours'

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
}

function dispatchHide() {
  window.dispatchEvent(new CustomEvent('help-mobile-tour-hide'))
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
  destroyActiveMobileTour()
  const startIndex = Math.max(0, opts.resumeFromStep ?? 0)
  await runMobileStep(def, startIndex)
}

async function runMobileStep(def: TourDefinition, index: number): Promise<void> {
  // Terminal step
  if (index >= def.steps.length) {
    destroyActiveMobileTour()
    clearSessionState()
    dispatchHide()
    return
  }
  const step = def.steps[index]
  const totalSteps = def.steps.length

  // Cross-route hop: persist with mobile flag and hard-nav
  if (!isOnRoute(step.route)) {
    saveSessionState({
      tourId: def.id,
      stepIndex: index,
      expiresAt: Date.now() + SESSION_TTL_MS,
      mobile: true,
    })
    destroyActiveMobileTour()
    dispatchHide()
    window.location.href = step.route
    return // Page reloads; <TourResumer /> resumes via startMobileTour.
  }

  // Resolve element (or null for body-anchored info steps)
  let target: HTMLElement | null = null
  if (step.element) {
    target = await waitForElement(resolveQuery(step.element), ELEMENT_WAIT_MS)
    if (!target) {
      toastWarning('Couldn\'t find that element — the app may have changed.')
      return runMobileStep(def, index + 1)
    }
    // Bring element into view before measuring; small delay so scroll settles.
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    await new Promise((r) => setTimeout(r, 150))
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
