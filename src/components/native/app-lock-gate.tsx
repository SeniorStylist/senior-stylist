'use client'

// Biometric App Lock overlay (W4). Native-only; renders null on web. When the
// device-local pref is on: locks on cold start and re-locks whenever the app goes
// to the background, then requires Face ID / Touch ID / fingerprint to reveal the
// UI again. Mounted next to <NativeBridge> in the root layout.

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { isNativeApp } from '@/lib/detect-device'
import { appLockEnabled, verifyAppLock } from '@/lib/app-lock'
import { haptics } from '@/lib/haptics'

export function AppLockGate() {
  const [locked, setLocked] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const verifyingRef = useRef(false)

  const unlock = useCallback(async () => {
    if (verifyingRef.current) return
    verifyingRef.current = true
    setVerifying(true)
    try {
      const ok = await verifyAppLock()
      if (ok) {
        haptics.success()
        setLocked(false)
      } else {
        haptics.error()
      }
    } finally {
      verifyingRef.current = false
      setVerifying(false)
    }
  }, [])

  useEffect(() => {
    if (!isNativeApp() || !appLockEnabled()) return

    // Cold start: lock immediately, then prompt.
    setLocked(true)
    void unlock()

    // Re-lock when the app goes to the background; prompt again on return.
    let remove: (() => void) | undefined
    ;(async () => {
      try {
        const { App } = await import('@capacitor/app')
        const sub = await App.addListener('appStateChange', ({ isActive }) => {
          if (!appLockEnabled()) return
          if (!isActive) {
            setLocked(true)
          } else {
            void unlock()
          }
        })
        remove = () => sub.remove()
      } catch {
        /* ignore */
      }
    })()
    return () => remove?.()
  }, [unlock])

  if (!locked) return null

  return (
    <div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center gap-6 px-8"
      style={{ backgroundColor: '#1C0A12' }}
    >
      <Image
        src="/seniorstylistlogo.jpg"
        alt="Senior Stylist"
        width={180}
        height={72}
        style={{ filter: 'brightness(0) invert(1)' }}
        priority
      />
      <p className="text-sm text-white/70 text-center">
        Senior Stylist is locked to protect resident information.
      </p>
      <button
        onClick={unlock}
        disabled={verifying}
        className="px-6 py-3 rounded-2xl bg-[#8B2E4A] text-white text-sm font-semibold active:scale-95 transition-all disabled:opacity-60"
      >
        {verifying ? 'Unlocking…' : 'Unlock'}
      </button>
    </div>
  )
}
