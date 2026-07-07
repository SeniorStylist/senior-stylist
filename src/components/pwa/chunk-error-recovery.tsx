'use client'

// Phase 23 — global stale-build recovery net. Dynamic-import failures inside
// EVENT HANDLERS (opening TakePaymentModal, running an export, starting a
// tour, tapping a nav route mid-deploy) surface as unhandled rejections and
// never reach any React error boundary — this component catches them and
// reloads once so the tab picks up the new build. Mounted in the ROOT layout
// (covers staff app + family portal). Render errors are covered separately by
// (protected)/error.tsx.

import { useEffect } from 'react'
import { isChunkError, reloadOnceForChunkError } from '@/lib/chunk-error'

export function ChunkErrorRecovery() {
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkError(e.reason)) {
        e.preventDefault()
        reloadOnceForChunkError()
      }
    }
    const onError = (e: ErrorEvent) => {
      if (isChunkError(e.error ?? e.message)) {
        reloadOnceForChunkError()
      }
    }
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [])

  return null
}
