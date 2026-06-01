// Phase 13-Tutorial: Scripted tour engine.
// Coexists with the legacy Driver.js engine — only handles the 10 new
// character-driven tutorials. Lazy-loaded to keep the main bundle clean.

import type { ScriptedTour, ScriptedTourState } from './scripted-tour-types'
import { setScriptedTourActive } from './tour-mode'
import { setTutorialCookie, clearTutorialCookie } from './tutorial-cookie'
import { getTourRouter } from './tour-router'
import { waitForElement, resolveQuery } from './tours'

const SESSION_KEY = 'scriptedTour'
const SESSION_TTL = 10 * 60 * 1000 // 10 minutes
const STEP_WAIT_MS = 3000 // worst-case wait for a step's target to mount

// Active capture-phase click listener for the current action step (if any).
let _activeListenerCleanup: (() => void) | null = null

let _activeTour: ScriptedTour | null = null
let _activeState: ScriptedTourState | null = null
let _setUiState: ((state: { tourId: string; stepIndex: number } | null) => void) | null = null

// Called by the ScriptedTourOverlay to register its state setter
export function registerScriptedTourUI(
  setter: (state: { tourId: string; stepIndex: number } | null) => void,
) {
  _setUiState = setter
}

export function getActiveTour() {
  return _activeTour
}

export function getActiveStep() {
  if (!_activeTour || !_activeState) return null
  return _activeTour.steps[_activeState.stepIndex] ?? null
}

export function getActiveState() {
  return _activeState
}

// Main entry point — called by tutorial cards, deep links, and the auto-launcher
export async function startScriptedTour(tourId: string, scenarioState: Record<string, string> = {}) {
  const { STYLIST_MOBILE_TOURS } = await import('./tours-stylist-mobile')
  const { STYLIST_DESKTOP_TOURS } = await import('./tours-stylist-desktop')
  const { MASTER_TOURS } = await import('./tours-master')
  const { FACILITY_STAFF_TOURS } = await import('./tours-facility-staff')
  const { ADMIN_TOURS } = await import('./tours-admin')
  const { BOOKKEEPER_TOURS } = await import('./tours-bookkeeper')
  const allTours = [
    ...STYLIST_MOBILE_TOURS,
    ...STYLIST_DESKTOP_TOURS,
    ...MASTER_TOURS,
    ...FACILITY_STAFF_TOURS,
    ...ADMIN_TOURS,
    ...BOOKKEEPER_TOURS,
  ]
  const tour = allTours.find((t) => t.id === tourId)
  if (!tour) {
    console.warn('[scripted-tour] Unknown tour:', tourId)
    return
  }

  // Scripted tours let real writes through (tagged is_demo via the tutorial-mode
  // cookie the server reads) — they do NOT install the legacy write-faking
  // interceptor.
  setTutorialCookie()
  setScriptedTourActive(true)

  _activeTour = tour
  _activeState = { tourId, stepIndex: 0, scenarioState, startedAt: Date.now() }

  // Navigate to the first step's route if we're not already there (so a tour
  // launched from /help lands on the right page before anchoring).
  const first = tour.steps[0]
  if (first?.route && typeof window !== 'undefined') {
    const resolved = resolveRoute(first.route)
    if (window.location.pathname !== resolved) {
      const router = getTourRouter()
      if (router) router.push(resolved)
      else window.location.href = resolved
    }
  }

  saveSessionState()
  _setUiState?.({ tourId, stepIndex: 0 })
  trackStep(tourId, 0, 'shown')
  wireStep(first, 0)
}

// Seed the facility's demo data, then start the tour with the resolved demo
// record IDs as scenarioState. The IDs are referenced by `type` steps via
// {{slug}} placeholders in typeValue (e.g. {{wash-and-set}}).
export async function seedAndStart(tourId: string): Promise<void> {
  let scenarioState: Record<string, string> = {}
  try {
    const res = await fetch('/api/help/seed-demo-data', { method: 'POST' })
    if (res.ok) {
      const { data } = await res.json()
      scenarioState = { ...data.residents, ...data.services, ...data.stylists }
    }
  } catch { /* seeding is best-effort; tour still runs */ }
  await startScriptedTour(tourId, scenarioState)
}

// Resolve {{slug}} placeholders in a route string (e.g. /residents/{{mrs-smith}}).
function resolveRoute(raw: string): string {
  return raw.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    return _activeState?.scenarioState?.[key] ?? key
  })
}

// Resolve {{slug}} placeholders in a type step's value. Special token
// {{tomorrow-10am}} → a datetime-local string for tomorrow at 10:00; everything
// else resolves against the seeded scenarioState IDs.
function resolveTypeValue(raw: string): string {
  const m = raw.match(/^\{\{(.+)\}\}$/)
  if (!m) return raw
  const key = m[1]
  const pad = (n: number) => String(n).padStart(2, '0')
  if (key === 'tomorrow-10am') {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`
  }
  if (key === 'tomorrow') {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  return _activeState?.scenarioState?.[key] ?? raw
}

export function advanceStep() {
  if (!_activeTour || !_activeState) return
  const nextIndex = _activeState.stepIndex + 1

  if (nextIndex >= _activeTour.steps.length) {
    // Terminal step
    completeTour()
    return
  }

  _activeState = { ..._activeState, stepIndex: nextIndex }
  saveSessionState()

  const step = _activeTour.steps[nextIndex]
  if (step?.route) {
    const resolved = resolveRoute(step.route)
    const router = getTourRouter()
    if (router) {
      router.push(resolved)
    } else {
      window.location.href = resolved
    }
  }

  _setUiState?.({ tourId: _activeState.tourId, stepIndex: nextIndex })
  trackStep(_activeState.tourId, nextIndex, 'shown')
  wireStep(step, nextIndex)
}

export function retreatStep() {
  if (!_activeTour || !_activeState) return
  const prevIndex = Math.max(0, _activeState.stepIndex - 1)
  _activeState = { ..._activeState, stepIndex: prevIndex }
  saveSessionState()
  _setUiState?.({ tourId: _activeState.tourId, stepIndex: prevIndex })
  wireStep(_activeTour.steps[prevIndex], prevIndex)
}

export function closeTour(reason: 'abandoned' | 'completed' = 'abandoned') {
  if (_activeState) {
    trackStep(_activeState.tourId, _activeState.stepIndex, reason)
  }
  clearActiveListener()
  setScriptedTourActive(false)
  clearTutorialCookie()
  clearSessionState()
  _activeTour = null
  _activeState = null
  _setUiState?.(null)
}

function completeTour() {
  if (!_activeTour || !_activeState) return
  const tourId = _activeTour.id
  trackStep(tourId, _activeState.stepIndex, 'completed')
  clearActiveListener()
  // Dispatch completion event (same pattern as legacy engine)
  window.dispatchEvent(new CustomEvent('tour-completed', { detail: { tourId } }))
  // Mark completed in profiles (fire-and-forget). Clear tutorial mode FIRST so
  // this write isn't tagged is_demo.
  setScriptedTourActive(false)
  clearTutorialCookie()
  fetch('/api/profile/complete-tour', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tourId }),
  }).catch(() => {})
  clearSessionState()
  _activeState = null
  // Show celebration — UI stays mounted with stepIndex = totalSteps
  _setUiState?.({ tourId, stepIndex: _activeTour.steps.length })
}

// ─── Step wiring ──────────────────────────────────────────────────────────
// Runs whenever we land on a step.
// - click steps: advance when the user clicks the highlighted element.
// - type steps: auto-fill the field. If the step has `advanceSelector` (a
//   typeahead result like "Mrs. Smith"), the user stays in control — they pick
//   the option themselves and that click advances. Otherwise the popover's Next
//   button advances (the value is already filled; the user just confirms).
// - info/highlight steps: the Next button drives them.
//
// Advance clicks are wired via DOCUMENT-LEVEL delegation rather than a listener
// on the element itself. Delegation is robust to: (1) typeahead options that
// remove themselves from the DOM on mousedown, (2) the dropdown re-rendering
// when the user edits the search text — a fresh option element still matches the
// selector. The mask is pointerEvents:none so we never block any interaction.
//
// Two modes controlled by `usePointerDown`:
//
//   false (default) — regular buttons, FABs, nav links.  We listen on the
//   BUBBLE-phase `click` event (not capture-phase pointerdown).  On mobile,
//   pointerdown fires at touchstart time — 100-300ms before the synthetic click
//   event and well before React's onClick handler runs.  Advancing on pointerdown
//   means the spotlight moves before the modal opens.  Listening on `click` lets
//   React's bubble-phase onClick complete first; our 50ms settle then fires after
//   the component has re-rendered (modal open, route changed, etc.).
//
//   true — typeahead dropdown options (advanceSelector).  These components call
//   onMouseDown (or onPointerDown) to prevent the input from losing focus, then
//   remove themselves from the DOM before the synthetic click fires.  We must
//   capture at pointerdown so the element is still in the DOM when we test it.
function wireAdvanceOnClick(resolvedSelector: string, index: number, usePointerDown = false) {
  let fired = false
  const handler = (e: Event) => {
    if (fired) return
    const t = e.target as HTMLElement | null
    if (!t || !t.closest(resolvedSelector)) return
    fired = true
    clearActiveListener()
    // 50ms settle: for click events, React's onClick has already run (same sync
    // tick); the settle covers async state batching and re-renders (typically
    // one rAF ≈ 16ms).  For pointerdown this is a best-effort gap.
    setTimeout(() => {
      if (_activeState?.stepIndex === index) advanceStep()
    }, 50)
  }
  // Bubble-phase for regular clicks (after React onClick); capture for typeahead.
  const eventType = usePointerDown ? 'pointerdown' : 'click'
  const useCapture = usePointerDown
  document.addEventListener(eventType, handler, useCapture)
  _activeListenerCleanup = () => {
    document.removeEventListener(eventType, handler, useCapture)
  }
}

function wireStep(step: ScriptedTour['steps'][number] | undefined, index: number) {
  clearActiveListener()
  if (!step?.selector) return
  const selector = resolveQuery(step.selector)

  if (step.type === 'click') {
    // Bubble-phase click — fires after React's onClick has run (modal opens,
    // route changes, etc.).  See wireAdvanceOnClick comment for why NOT pointerdown.
    wireAdvanceOnClick(selector, index, false)
    return
  }

  if (step.type === 'type' && step.typeValue != null) {
    const value = resolveTypeValue(step.typeValue)
    void waitForElement(selector, STEP_WAIT_MS).then((el) => {
      if (!el || _activeState?.stepIndex !== index) return
      autoFillInput(el, value)
    })
    // advanceSelector: typeahead option element that removes itself on mousedown.
    // Must use pointerdown capture so the element is still in the DOM when we
    // check it.  See wireAdvanceOnClick comment.
    if (step.advanceSelector) {
      wireAdvanceOnClick(resolveQuery(step.advanceSelector), index, true)
    }
  }
}

function clearActiveListener() {
  if (_activeListenerCleanup) {
    _activeListenerCleanup()
    _activeListenerCleanup = null
  }
}

// Auto-fill a React controlled input/textarea/select using the native setter
// trick so the controlled component's onChange fires.
function autoFillInput(el: HTMLElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement
      ? window.HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  el.dispatchEvent(new InputEvent('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// Session persistence — survive soft navigations
function saveSessionState() {
  if (!_activeState) return
  try {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ..._activeState, expiresAt: Date.now() + SESSION_TTL }),
    )
  } catch { /* quota */ }
}

function clearSessionState() {
  try { sessionStorage.removeItem(SESSION_KEY) } catch { /* noop */ }
}

export function resumeScriptedTour(): boolean {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return false
    const saved = JSON.parse(raw) as ScriptedTourState & { expiresAt: number }
    if (saved.expiresAt < Date.now()) {
      clearSessionState()
      return false
    }
    startScriptedTour(saved.tourId, saved.scenarioState)
    // Jump to the saved step
    if (_activeTour && _activeState && saved.stepIndex > 0) {
      _activeState.stepIndex = saved.stepIndex
      _setUiState?.({ tourId: saved.tourId, stepIndex: saved.stepIndex })
      wireStep(_activeTour.steps[saved.stepIndex], saved.stepIndex)
    }
    return true
  } catch {
    return false
  }
}

// Telemetry — fire-and-forget
function trackStep(tourId: string, stepIndex: number, action: string) {
  fetch('/api/help/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tourId, stepIndex, action }),
  }).catch(() => {})
}
