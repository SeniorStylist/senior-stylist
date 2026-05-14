'use client'

import { useEffect, useState } from 'react'
import { detectDevice, isInstallable, getiOSUIVariant } from '@/lib/detect-device'
import { InstallGuide } from './install-guide'
import type { DeviceType } from '@/lib/detect-device'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'pwa_install_dismissed'
const DISMISS_DAYS = 7

function wasDismissedRecently(): boolean {
  try {
    const ts = localStorage.getItem(DISMISSED_KEY)
    if (!ts) return false
    const age = Date.now() - parseInt(ts, 10)
    return age < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

function getBannerCopy(device: DeviceType, hasNativePrompt: boolean): { title: string; subtitle: string } {
  if (device === 'ios-safari') {
    const variant = getiOSUIVariant()
    if (variant === 'ios26+') return { title: 'Save to home screen', subtitle: 'Tap ⋯ then Share' }
    return { title: 'Save to home screen', subtitle: 'Tap the share icon in Safari' }
  }
  if (device === 'android-chrome' || device === 'android-samsung' || device === 'android-other') {
    if (hasNativePrompt) return { title: 'Install Senior Stylist', subtitle: 'Add it as an app in one tap' }
    return { title: 'Add to home screen', subtitle: 'For faster access' }
  }
  return { title: 'Add to home screen', subtitle: 'For the best experience' }
}

export default function InstallBanner() {
  const [show, setShow] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [deviceType, setDeviceType] = useState<DeviceType>('unknown')
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    if (!isInstallable()) return
    if (wasDismissedRecently()) return

    const device = detectDevice()
    setDeviceType(device)

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall)

    // Only show after 10 seconds — don't interrupt on first load
    const timer = setTimeout(() => setShow(true), 10_000)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
    }
  }, [])

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())) } catch { /* ignore */ }
    setShow(false)
  }

  const handleInstalled = () => {
    setShow(false)
    setGuideOpen(false)
  }

  if (!show) return null

  const { title, subtitle } = getBannerCopy(deviceType, deferredPrompt !== null)

  return (
    <>
      <div
        className="md:hidden fixed left-3 right-3 z-30 rounded-2xl shadow-lg flex items-center"
        style={{ backgroundColor: '#1C0A12', bottom: 'var(--app-floating-bottom)' }}
      >
        {/* Tappable main area — opens install guide */}
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="flex-1 flex items-center gap-3 px-4 py-3 text-left"
        >
          <div className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <rect x="5" y="2" width="14" height="20" rx="2"/>
              <line x1="12" y1="18" x2="12.01" y2="18"/>
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white leading-tight">{title}</p>
            <p className="text-xs text-white/60 leading-tight mt-0.5">{subtitle} →</p>
          </div>
        </button>

        {/* Dismiss only — no competing right-side button */}
        <button
          type="button"
          onClick={handleDismiss}
          className="shrink-0 text-white/50 hover:text-white/90 transition-colors px-4 py-3"
          aria-label="Dismiss"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <InstallGuide
        isOpen={guideOpen}
        onClose={() => setGuideOpen(false)}
        deviceType={deviceType}
        deferredPrompt={deferredPrompt}
        onInstalled={handleInstalled}
      />
    </>
  )
}
