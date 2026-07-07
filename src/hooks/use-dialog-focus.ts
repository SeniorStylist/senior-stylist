'use client'

// Phase 19 a11y — minimal dialog focus management shared by Modal + BottomSheet:
// on open, remember the trigger and move focus into the dialog; trap Tab inside;
// on close, return focus to the trigger. Deliberately tiny — no dependency.

import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useDialogFocus(containerRef: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Move focus in: first focusable, else the container itself.
    const first = container.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? container).focus({ preventScroll: true })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      )
      if (focusables.length === 0) return
      const firstEl = focusables[0]
      const lastEl = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === firstEl || active === container)) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }
    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [containerRef, open])
}
