'use client'

import { useEffect } from 'react'
import { useIsMobile } from '@/hooks/use-is-mobile'

interface FirstTourAutoLauncherProps {
  role: string
}

const MOBILE_TOUR_ID = 'scripted-stylist-getting-started-mobile'
const DESKTOP_TOUR_ID = 'scripted-stylist-getting-started-desktop'
// Wait for target element to appear before launching (up to 3s)
const TARGET_MOBILE = '[data-tour-mobile="stylist-mobile-booking-list"]'
const TARGET_DESKTOP = '[data-tour="calendar-time-grid"]'
const LAUNCH_DELAY_MS = 1500
const WAIT_TIMEOUT_MS = 3000

export function FirstTourAutoLauncher({ role }: FirstTourAutoLauncherProps) {
  const isMobile = useIsMobile()

  useEffect(() => {
    if (role !== 'stylist') return

    // Mark seen immediately so a second render doesn't re-launch
    fetch('/api/profile/first-tour-seen', { method: 'POST' }).catch(() => {})

    const tourId = isMobile ? MOBILE_TOUR_ID : DESKTOP_TOUR_ID
    const target = isMobile ? TARGET_MOBILE : TARGET_DESKTOP

    let launched = false
    let timer: ReturnType<typeof setTimeout>

    function tryLaunch() {
      if (launched) return
      if (!document.querySelector(target)) return
      launched = true
      import('@/lib/help/scripted-tour').then((m) => m.startScriptedTour(tourId))
    }

    // Wait for the UI to settle, then check for the target element
    timer = setTimeout(() => {
      tryLaunch()
      if (!launched) {
        // Poll until target appears or timeout
        const observer = new MutationObserver(() => {
          if (!launched) tryLaunch()
          if (launched) observer.disconnect()
        })
        observer.observe(document.body, { childList: true, subtree: true })
        setTimeout(() => observer.disconnect(), WAIT_TIMEOUT_MS)
      }
    }, LAUNCH_DELAY_MS)

    return () => clearTimeout(timer)
  }, [role, isMobile])

  return null
}
