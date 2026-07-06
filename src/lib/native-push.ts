// Client-side native push registration (N3). Only meaningful inside the Capacitor
// shell — every entry point no-ops on web/PWA/SSR. The FCM device token is sent to
// POST /api/push/subscribe as { platform, token } and remembered in localStorage so
// the my-account toggle can reflect state and re-registration can happen on app
// resume (FCM tokens rotate).
//
// Permission is requested ONLY from the explicit opt-in toggle (never on launch).

import { isNativeApp, nativePlatform } from '@/lib/detect-device'

const TOKEN_KEY = 'nativePushToken'

export function nativePushEnabled(): boolean {
  if (typeof window === 'undefined' || !isNativeApp()) return false
  return !!localStorage.getItem(TOKEN_KEY)
}

async function postToken(token: string): Promise<void> {
  const platform = nativePlatform()
  if (platform === 'web') return
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, token }),
  })
  localStorage.setItem(TOKEN_KEY, token)
}

/**
 * Opt in: request permission, register with APNs/FCM, and store the device token
 * server-side. Resolves true when registration succeeded (token received).
 */
export async function enableNativePush(): Promise<boolean> {
  if (!isNativeApp()) return false
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    let perm = await PushNotifications.checkPermissions()
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions()
    }
    if (perm.receive !== 'granted') return false

    const token = await new Promise<string | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 15000)
      PushNotifications.addListener('registration', (t) => {
        clearTimeout(timeout)
        resolve(t.value)
      })
      PushNotifications.addListener('registrationError', (err) => {
        clearTimeout(timeout)
        console.error('[native-push] registration error:', err)
        resolve(null)
      })
      void PushNotifications.register()
    })
    if (!token) return false

    await postToken(token)
    return true
  } catch (err) {
    console.error('[native-push] enable failed:', err)
    return false
  }
}

/** Opt out: remove the server row and forget the local token. */
export async function disableNativePush(): Promise<void> {
  if (typeof window === 'undefined') return
  const token = localStorage.getItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY)
  if (!token) return
  try {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: token }),
    })
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.removeAllListeners()
    await PushNotifications.unregister().catch(() => {})
  } catch (err) {
    console.error('[native-push] disable failed:', err)
  }
}

let _tapWired = false

/**
 * W6: navigate when the user taps a notification. The FCM payload carries
 * data.url (set by sendFcmToToken); fall back to /dashboard. Hard navigation is
 * intentional — the app may be cold-starting from the tap.
 */
export async function wirePushTapNavigation(): Promise<void> {
  if (!isNativeApp() || _tapWired) return
  _tapWired = true
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const url = (action.notification?.data as { url?: string } | undefined)?.url
      if (url && url.startsWith('/')) window.location.assign(url)
      else window.location.assign('/dashboard')
    })
  } catch {
    _tapWired = false
  }
}

/**
 * Silent re-registration on app start/resume for users who previously opted in —
 * FCM tokens rotate, and re-posting keeps the server row fresh. Never prompts
 * (permission was already granted; if it was revoked in OS settings this no-ops).
 */
export async function resumeNativePushIfEnabled(): Promise<void> {
  if (!isNativeApp() || !nativePushEnabled()) return
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') return
    PushNotifications.addListener('registration', (t) => {
      const prev = localStorage.getItem(TOKEN_KEY)
      if (t.value && t.value !== prev) void postToken(t.value)
    })
    void PushNotifications.register()
  } catch {
    /* ignore — opt-in flow will retry */
  }
}
