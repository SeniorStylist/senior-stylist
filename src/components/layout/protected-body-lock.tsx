'use client'

import { useEffect } from 'react'

/**
 * Locks body + html overflow while the protected layout is mounted so iOS Safari
 * can't bounce-scroll the document behind the `fixed inset-0` shell. Restores the
 * previous values on unmount so login / family portal / public routes regain their
 * normal-flow scrolling.
 *
 * Mirrors the existing `body.style.overflow` flip pattern in `Modal` and
 * `BottomSheet`.
 */
export function ProtectedBodyLock() {
  useEffect(() => {
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [])
  return null
}
