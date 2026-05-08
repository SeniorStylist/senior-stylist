'use client'

import { useEffect } from 'react'
import { useToast } from '@/components/ui/toast'
import { resumePendingTour } from '@/lib/help/tours'

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
    // Run after first paint so the page is mounted before the tour highlights anything
    const t = setTimeout(() => {
      void resumePendingTour()
    }, 100)
    return () => clearTimeout(t)
    // Empty deps: resume only on the initial mount of the protected layout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
