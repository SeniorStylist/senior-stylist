// P31 — tiny DOM helpers + step types extracted from tours.ts so the three
// ALWAYS-MOUNTED layout components (tour-resumer, mobile-tour-overlay,
// scripted-tour-overlay) stop dragging the full 1100-line tour catalog into
// the shared layout bundle. tours.ts re-exports everything here
// (`export * from './tour-dom'`) so every existing import keeps working.
// This module must stay dependency-free (imports nothing from src/lib/help).

export type TourStep = {
  /** CSS selector for the element to highlight. Empty string = no highlight (info-only step). */
  element: string
  /** Pathname this element lives on. Hard-nav to here if window.location.pathname differs. */
  route: string
  title: string
  description: string
  /** true = wait for user to click highlighted element to advance; false = show Next button. */
  isAction: boolean
  /** Sub-text shown below description on action steps, e.g. "Tap Calendar to continue". */
  actionHint?: string
  /** Optional mobile-specific title; falls back to `title` when omitted (Phase 12J). */
  mobileTitle?: string
  /** Optional mobile-specific description; falls back to `description` when omitted (Phase 12J). */
  mobileDescription?: string
}

export type TourDefinition = {
  id: string
  title: string
  steps: TourStep[]
}

export const SESSION_KEY = 'helpTour'
export const SESSION_TTL_MS = 5 * 60 * 1000 // 5 minutes

export const isMobile = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(max-width: 767px)').matches

/**
 * On mobile, prefer [data-tour-mobile="X"] but fall back to [data-tour="X"].
 * Lets step authors write a single selector and have it resolve correctly per device.
 */
export function resolveQuery(selector: string): string {
  if (!isMobile()) return selector
  const m = selector.match(/^\[data-tour="([^"]+)"\]$/)
  if (!m) return selector
  return `[data-tour-mobile="${m[1]}"], [data-tour="${m[1]}"]`
}

/**
 * Pick the first VISIBLE element matching a resolved selector. Critical for
 * mobile: `resolveQuery` produces a comma selector
 * (`[data-tour-mobile="X"], [data-tour="X"]`) and `querySelector` returns the
 * first DOM match regardless of selector order — which is usually the hidden
 * desktop sidebar element (`display:none`, earlier in the DOM) rather than the
 * visible mobile nav element. We scan ALL matches and return the first that is
 * actually rendered. `getClientRects().length > 0` is the right test: it's true
 * for `position:fixed` elements (whose `offsetParent` is always null) and false
 * for `display:none`. Falls back to the first match if none are visible (so the
 * caller can still wait for it to appear).
 */
export function firstVisibleMatch(resolvedSelector: string): HTMLElement | null {
  const matches = document.querySelectorAll<HTMLElement>(resolvedSelector)
  for (const el of matches) {
    if (el.getClientRects().length > 0) return el
  }
  return matches[0] ?? null
}

/**
 * Phase 12P — MutationObserver-based element wait. Resolves the instant the
 * selector matches a visible element, or null after `timeoutMs`. Returns
 * immediately when the element is already in the DOM (no requestAnimationFrame
 * delay). Always disconnects the observer on resolve OR timeout.
 */
export function waitForElement(selector: string, timeoutMs: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const isVisible = (el: HTMLElement | null): el is HTMLElement =>
      !!el && el.getClientRects().length > 0

    const existing = firstVisibleMatch(selector)
    if (isVisible(existing)) {
      resolve(existing)
      return
    }

    let settled = false
    const observer = new MutationObserver(() => {
      if (settled) return
      const el = firstVisibleMatch(selector)
      if (isVisible(el)) {
        settled = true
        clearTimeout(timer)
        observer.disconnect()
        resolve(el)
      }
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      observer.disconnect()
      resolve(null)
    }, timeoutMs)

    observer.observe(document.body, { childList: true, subtree: true })
  })
}
