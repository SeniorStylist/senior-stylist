'use client'

// Phase 17 — universal offline banner (web + PWA + native shell). Replaces the
// native-only banner that used to live inside <NativeBridge> (which keeps its
// Capacitor replay triggers). Mounted in the root layout so staff pages AND the
// family portal get it.
//
// States:
//   offline           → dark bar: "Offline — N changes will sync…"
//   reconnected+queue → burgundy bar: "Back online — syncing…" until the queue
//                       drains, then a brief "All changes synced ✓" flash.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getPendingCount, replayQueue, subscribePending } from '@/lib/offline-queue'
import { getPhotoPendingCount, replayPhotoQueue, subscribePhotoPending } from '@/lib/offline-photo-queue'

type Phase = 'hidden' | 'offline' | 'syncing' | 'synced'

export function OfflineBanner() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('hidden')
  const [pendingJson, setPendingJson] = useState(0)
  const [pendingPhotos, setPendingPhotos] = useState(0)
  const pending = pendingJson + pendingPhotos
  const phaseRef = useRef<Phase>('hidden')
  phaseRef.current = phase

  useEffect(() => subscribePending(setPendingJson), [])
  useEffect(() => subscribePhotoPending(setPendingPhotos), [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const goOffline = () => setPhase('offline')
    const goOnline = () => {
      if (getPendingCount() + getPhotoPendingCount() > 0) {
        setPhase('syncing')
        void Promise.all([replayQueue(), replayPhotoQueue()]).then(() => {
          // Whatever synced, refresh server components so the UI reconciles.
          router.refresh()
          if (getPendingCount() + getPhotoPendingCount() === 0) {
            setPhase('synced')
            setTimeout(() => {
              if (phaseRef.current === 'synced') setPhase('hidden')
            }, 2500)
          } else {
            // Some writes still queued (e.g. server 5xx) — keep it visible.
            setPhase(navigator.onLine ? 'hidden' : 'offline')
          }
        })
      } else {
        setPhase('hidden')
      }
    }

    if (!navigator.onLine) setPhase('offline')
    // Wedge-proof replay on load: a write queued by a TRANSIENT fetch failure
    // (server hiccup / flaky wifi) never gets an offline→online transition, so
    // the 'online'-event-only replay left it stuck forever — edits silently
    // vanished on reload (bookkeeper report 2026-07-13). Drain on every mount.
    if (navigator.onLine && getPendingCount() + getPhotoPendingCount() > 0) {
      goOnline()
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [router])

  if (phase === 'hidden') return null

  const styles: Record<Exclude<Phase, 'hidden'>, string> = {
    offline: 'bg-stone-800/95 text-white',
    syncing: 'bg-[#8B2E4A]/95 text-white',
    synced: 'bg-emerald-600/95 text-white',
  }
  const label =
    phase === 'offline'
      ? pending > 0
        ? `Offline — ${pending} change${pending === 1 ? '' : 's'} will sync when you're back`
        : "You're offline — recent info is shown and changes will wait to sync"
      : phase === 'syncing'
        ? `Back online — syncing ${pending || ''} change${pending === 1 ? '' : 's'}…`
        : 'All changes synced ✓'

  return (
    <div
      role="status"
      className={`fixed top-0 left-0 right-0 z-[260] text-center text-[12px] font-semibold backdrop-blur-sm ${styles[phase]}`}
      style={{ paddingTop: 'calc(0.3rem + env(safe-area-inset-top))', paddingBottom: '0.3rem' }}
    >
      {label}
    </div>
  )
}
