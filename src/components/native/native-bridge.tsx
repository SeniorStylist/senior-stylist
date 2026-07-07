'use client'

// Wires the Capacitor native shell to the web app. Runs ONLY inside the native app
// (no-op on web/PWA/SSR). Handles: hiding the splash once the web is interactive,
// status-bar styling, keyboard resize, the Android hardware back button, session
// refresh on app resume, push token refresh + notification-tap navigation, and an
// offline banner. All plugin imports are dynamic so nothing lands in the web bundle.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { isNativeApp, nativePlatform } from '@/lib/detect-device'
import { resumeNativePushIfEnabled, wirePushTapNavigation } from '@/lib/native-push'
import { replayQueue, subscribePending } from '@/lib/offline-queue'

export function NativeBridge() {
  const router = useRouter()
  // W5: offline awareness — banner shown while the device has no connection.
  const [offline, setOffline] = useState(false)
  // F6: queued offline writes waiting to sync (shown in the banner)
  const [pending, setPending] = useState(0)

  useEffect(() => subscribePending(setPending), [])

  useEffect(() => {
    if (!isNativeApp()) return
    const platform = nativePlatform()
    const cleanups: Array<() => void> = []

    // N2: enable native-only CSS (globals.css `html.native-app { … }`) without
    // touching the web build — e.g. suppressing the iOS long-press callout.
    document.documentElement.classList.add('native-app')
    cleanups.push(() => document.documentElement.classList.remove('native-app'))

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
        // F6: also replay any offline-queued writes before the refresh lands.
        const state = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            void replayQueue()
            router.refresh()
          }
        })
        cleanups.push(() => state.remove())
      } catch { /* ignore */ }

      // W5: offline banner — initial status + live changes.
      try {
        const { Network } = await import('@capacitor/network')
        const status = await Network.getStatus()
        setOffline(!status.connected)
        const net = await Network.addListener('networkStatusChange', (s) => {
          setOffline(!s.connected)
          // F6: connectivity is back — replay queued writes
          if (s.connected) void replayQueue()
        })
        cleanups.push(() => net.remove())
      } catch { /* ignore */ }

      // Hide the splash now that the web app is mounted + interactive.
      try {
        const { SplashScreen } = await import('@capacitor/splash-screen')
        await SplashScreen.hide()
      } catch { /* ignore */ }

      // N3: silently refresh the FCM token for users who already opted in to
      // push (tokens rotate). Never prompts — opt-in lives in /my-account.
      void resumeNativePushIfEnabled()

      // W6: notification tap → navigate to the push payload's url.
      void wirePushTapNavigation()
    })()

    return () => cleanups.forEach((fn) => fn())
  }, [router])

  if (!offline) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[260] text-center text-[12px] font-semibold text-white bg-stone-800/95 backdrop-blur-sm"
      style={{ paddingTop: 'calc(0.3rem + env(safe-area-inset-top))', paddingBottom: '0.3rem' }}
    >
      {pending > 0
        ? `Offline — ${pending} change${pending === 1 ? '' : 's'} will sync when you're back`
        : 'No internet connection — changes may not save'}
    </div>
  )
}
