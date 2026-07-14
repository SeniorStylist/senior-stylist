'use client'

import { useEffect } from 'react'
import { useToast } from '@/components/ui/toast'
import { SESSION_KEY } from '@/lib/help/tour-dom'
import { installTourFetchInterceptor } from '@/lib/help/tour-fetch-interceptor'

/**
 * Mounted at the protected layout level so tours that hard-nav between routes
 * (e.g. /dashboard → /log) can resume from where they left off.
 *
 * Also bridges the engine's CustomEvent toast surface into useToast(), since
 * the tour engine runs outside React.
 */
export function TourResumer() {
  const { toast } = useToast()

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ kind: 'warning' | 'info'; message: string }>
      if (!ce.detail) return
      if (ce.detail.kind === 'warning') {
        toast.error(ce.detail.message)
      } else {
        toast.info(ce.detail.message)
      }
    }
    window.addEventListener('help-tour-toast', handler)
    return () => window.removeEventListener('help-tour-toast', handler)
  }, [toast])

  useEffect(() => {
    // Phase 12O — re-install the fetch interceptor on every protected-layout
    // mount. Page reloads (cross-route tour hops) wipe module state, so the
    // patch needs to be re-applied before resumePendingTour() fires off any
    // restoration flow. setTourModeActive(true) is handled inside startTour /
    // startMobileTour, so we don't duplicate it here.
    installTourFetchInterceptor()
    // Run after first paint so the page is mounted before the tour highlights
    // anything. P31 — the tour engine (tours.ts, ~1100 lines of catalog) is
    // dynamic-imported ONLY when a resume blob actually exists, so the shared
    // layout bundle no longer carries it. resumePendingTour() would no-op
    // without the blob anyway.
    const t = setTimeout(() => {
      let hasResumeState = false
      try { hasResumeState = !!sessionStorage.getItem(SESSION_KEY) } catch { /* private mode */ }
      if (!hasResumeState) return
      void import('@/lib/help/tours').then(({ resumePendingTour }) => resumePendingTour())
    }, 100)
    return () => clearTimeout(t)
    // Empty deps: resume only on the initial mount of the protected layout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
