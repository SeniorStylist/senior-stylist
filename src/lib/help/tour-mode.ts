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

// Phase 13-Tutorial — separate flag for the scripted-tour engine. Unlike the
// legacy flag above (which drives the write-FAKING interceptor), this flag
// drives the tutorial fetch WRAPPER, which lets real writes through but tags
// them with the X-Tutorial-Mode header so the server persists is_demo=true and
// relaxes its demo read filters. Kept distinct so the two engines never
// interfere — a scripted tour never fakes writes, and a legacy tour never tags.
let _scriptedTourActive = false

export function setScriptedTourActive(active: boolean) {
  _scriptedTourActive = active
}

