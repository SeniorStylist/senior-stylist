// Phase 13-Tutorial: Scripted tour engine.
// Coexists with the legacy Driver.js engine — only handles the 10 new
// character-driven tutorials. Lazy-loaded to keep the main bundle clean.

import type { ScriptedTour, ScriptedTourState } from './scripted-tour-types'
import { setTourModeActive } from './tour-mode'
import { installTourFetchInterceptor } from './tour-fetch-interceptor'
import { getTourRouter } from './tour-router'

const SESSION_KEY = 'scriptedTour'
const SESSION_TTL = 10 * 60 * 1000 // 10 minutes

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
  const allTours = [...STYLIST_MOBILE_TOURS, ...STYLIST_DESKTOP_TOURS]
  const tour = allTours.find((t) => t.id === tourId)
  if (!tour) {
    console.warn('[scripted-tour] Unknown tour:', tourId)
    return
  }

  installTourFetchInterceptor()
  setTourModeActive(true)

  _activeTour = tour
  _activeState = { tourId, stepIndex: 0, scenarioState, startedAt: Date.now() }

  saveSessionState()
  _setUiState?.({ tourId, stepIndex: 0 })
  trackStep(tourId, 0, 'shown')
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
  if (step) {
    // Navigate if the step requires a different route
    if (step.route) {
      const router = getTourRouter()
      if (router) {
        router.push(step.route)
      } else {
        window.location.href = step.route
      }
    }
  }

  _setUiState?.({ tourId: _activeState.tourId, stepIndex: nextIndex })
  trackStep(_activeState.tourId, nextIndex, 'shown')

  // Auto-fill for type steps
  if (step?.type === 'type' && step.selector && step.typeValue) {
    setTimeout(() => autoFillInput(step.selector!, step.typeValue!), 150)
  }
}

export function retreatStep() {
  if (!_activeTour || !_activeState) return
  const prevIndex = Math.max(0, _activeState.stepIndex - 1)
  _activeState = { ..._activeState, stepIndex: prevIndex }
  saveSessionState()
  _setUiState?.({ tourId: _activeState.tourId, stepIndex: prevIndex })
}

export function closeTour(reason: 'abandoned' | 'completed' = 'abandoned') {
  if (_activeState) {
    trackStep(_activeState.tourId, _activeState.stepIndex, reason)
  }
  setTourModeActive(false)
  clearSessionState()
  _activeTour = null
  _activeState = null
  _setUiState?.(null)
}

function completeTour() {
  if (!_activeTour || !_activeState) return
  const tourId = _activeTour.id
  trackStep(tourId, _activeState.stepIndex, 'completed')
  // Dispatch completion event (same pattern as legacy engine)
  window.dispatchEvent(new CustomEvent('tour-completed', { detail: { tourId } }))
  // Mark completed in profiles (fire-and-forget)
  fetch('/api/profile/complete-tour', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tourId }),
  }).catch(() => {})
  setTourModeActive(false)
  clearSessionState()
  _activeState = null
  // Show celebration — UI stays mounted with stepIndex = totalSteps
  _setUiState?.({ tourId, stepIndex: _activeTour.steps.length })
}

// Auto-fill a React controlled input using the native setter trick
function autoFillInput(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  if (!input) return
  const nativeInputValueSetter =
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ??
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, value)
  }
  input.dispatchEvent(new InputEvent('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
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
    if (_activeState && saved.stepIndex > 0) {
      _activeState.stepIndex = saved.stepIndex
      _setUiState?.({ tourId: saved.tourId, stepIndex: saved.stepIndex })
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
