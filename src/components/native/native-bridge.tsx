'use client'

// Wires the Capacitor native shell to the web app. Renders nothing; runs once on
// mount and ONLY inside the native app (no-op on web/PWA/SSR). Handles: hiding the
// splash once the web is interactive, status-bar styling, keyboard resize, the
// Android hardware back button, and session refresh on app resume. All plugin
// imports are dynamic so nothing lands in the web bundle.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isNativeApp, nativePlatform } from '@/lib/detect-device'

export function NativeBridge() {
  const router = useRouter()

  useEffect(() => {
    if (!isNativeApp()) return
    const platform = nativePlatform()
    const cleanups: Array<() => void> = []

    ;(async () => {
      // Status bar — light text over the burgundy header; don't overlay the webview
      // (the layout already handles safe-area insets itself).
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar')
        await StatusBar.setStyle({ style: Style.Light })
        if (platform === 'android') await StatusBar.setBackgroundColor({ color: '#8B2E4A' })
        await StatusBar.setOverlaysWebView({ overlay: false })
      } catch { /* ignore */ }

      // Keyboard — resize the webview natively so inputs stay visible.
      try {
        const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard')
        await Keyboard.setResizeMode({ mode: KeyboardResize.Native })
        await Keyboard.setAccessoryBarVisible({ isVisible: false })
      } catch { /* ignore */ }

      // Android hardware back button → in-app back, or exit at the root.
      try {
        const { App } = await import('@capacitor/app')
        const back = await App.addListener('backButton', () => {
          if (window.history.length > 1) router.back()
          else App.exitApp()
        })
        cleanups.push(() => back.remove())

        // Refresh server components when the app returns to the foreground so data
        // (calendar, daily log, balances) isn't stale after a long background.
        const state = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) router.refresh()
        })
        cleanups.push(() => state.remove())
      } catch { /* ignore */ }

      // Hide the splash now that the web app is mounted + interactive.
      try {
        const { SplashScreen } = await import('@capacitor/splash-screen')
        await SplashScreen.hide()
      } catch { /* ignore */ }
    })()

    return () => cleanups.forEach((fn) => fn())
  }, [router])

  return null
}
