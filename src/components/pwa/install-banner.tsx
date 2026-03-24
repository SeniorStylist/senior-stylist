'use client'

import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [show, setShow] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    // Don't show if already installed as PWA
    if (window.matchMedia('(display-mode: standalone)').matches) return
    // Don't show if previously dismissed
    if (localStorage.getItem('pwa-banner-dismissed')) return

    const ua = navigator.userAgent
    const iosDevice = /iphone|ipad|ipod/i.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream
    setIsIOS(iosDevice)

    if (iosDevice) {
      setShow(true)
      return
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setShow(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setShow(false)
    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    localStorage.setItem('pwa-banner-dismissed', '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="fixed bottom-20 left-4 right-4 z-30 rounded-2xl bg-[#0D7377] text-white shadow-lg p-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight">Install Senior Stylist</p>
        {isIOS ? (
          <p className="text-xs text-white/80 mt-0.5">
            Tap <span className="font-medium">Share</span> → <span className="font-medium">Add to Home Screen</span>
          </p>
        ) : (
          <p className="text-xs text-white/80 mt-0.5">Get the best experience on your device</p>
        )}
      </div>
      {!isIOS && (
        <button
          onClick={handleInstall}
          className="shrink-0 text-xs font-semibold bg-white text-[#0D7377] px-3 py-1.5 rounded-xl"
        >
          Add to Home Screen
        </button>
      )}
      <button
        onClick={handleDismiss}
        className="shrink-0 text-white/70 hover:text-white text-lg leading-none"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
