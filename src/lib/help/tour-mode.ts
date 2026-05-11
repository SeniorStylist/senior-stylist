// Phase 12O — Tour Mode (Demo Mode) flag.
//
// Module-level state shared by both tour engines (desktop Driver.js + mobile
// overlay) and the fetch interceptor. Lives outside React so the engines can
// flip it without prop drilling. Components subscribe via the
// `tour-mode-change` CustomEvent.

let _tourModeActive = false

export function setTourModeActive(active: boolean) {
  if (_tourModeActive === active) return
  _tourModeActive = active
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('tour-mode-change', { detail: { active } }),
    )
  }
}

export function isTourModeActive(): boolean {
  return _tourModeActive
}
