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
// Runs whenever we land on a step. Click steps wait for the real element and
// advance on the user's real click; type steps auto-fill the field (the popover
// shows Next so the user reads what happened, then advances). Info/highlight
// steps need nothing — the popover's Next button drives them.
function wireStep(step: ScriptedTour['steps'][number] | undefined, index: number) {
  clearActiveListener()
  if (!step?.selector) return
  const selector = resolveQuery(step.selector)

  if (step.type === 'click') {
    void waitForElement(selector, STEP_WAIT_MS).then((target) => {
      if (!target || _activeState?.stepIndex !== index) return
      let fired = false
      const advance = () => {
        if (fired) return
        fired = true
        clearActiveListener()
        // 50ms lets React flush the click's onClick (open modal, fire nav) before we
        // re-render the next step's spotlight mask.
        setTimeout(() => advanceStep(), 50)
      }
      // Primary path: advance on the completed click. The full gesture
      // (pointerdown → pointerup → click) is done by the time `click` fires, so the
      // user has already released the button — the next step's mask can't steal the
      // tail of the gesture, and the target's real React onClick has run (form/modal
      // is opening). Advancing on pointerdown instead caused the mask to cover the
      // button mid-press, so the release landed on the mask and onClick never fired.
      const onClick = () => advance()
      // Fallback for elements that remove themselves from the DOM on mousedown (e.g. a
      // typeahead option that closes its own dropdown) — `click` never lands. If the
      // target detaches shortly after pointerdown, advance anyway; the selection it
      // triggered already happened on mousedown.
      const onPointerDown = () => {
        setTimeout(() => {
          if (!fired && !document.contains(target)) advance()
        }, 120)
      }
      target.addEventListener('click', onClick)
      target.addEventListener('pointerdown', onPointerDown, true)
      _activeListenerCleanup = () => {
        target.removeEventListener('click', onClick)
        target.removeEventListener('pointerdown', onPointerDown, true)
      }
    })
    return
  }

  if (step.type === 'type' && step.typeValue != null) {
    const value = resolveTypeValue(step.typeValue)
    void waitForElement(selector, STEP_WAIT_MS).then((el) => {
      if (!el || _activeState?.stepIndex !== index) return
      autoFillInput(el, value)
      // Auto-advance so the user never has to tap "Next" on a type step.
      // Tapping Next would blur the input, closing typeahead dropdowns before
      // the following click step can wire up (e.g. the Mrs. Smith option
      // disappears). 900ms gives debounced dropdowns time to render so the
      // ring highlights the option the moment the step transitions.
      setTimeout(() => {
        if (_activeState?.stepIndex === index) advanceStep()
      }, 900)
    })
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
