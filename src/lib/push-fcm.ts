// Server-side FCM sender for NATIVE push (iOS + Android via Firebase Cloud
// Messaging; iOS is delivered through APNs by Firebase once an APNs key is
// uploaded to the Firebase project). Mirrors the VAPID/TWILIO gating pattern:
// a strict no-op until FIREBASE_SERVICE_ACCOUNT_BASE64 is set (base64 of the
// Firebase service-account JSON — Firebase console → Project settings →
// Service accounts → Generate new private key). Never throws.

import type { App } from 'firebase-admin/app'

let _app: App | null = null
let _initFailed = false

async function getFcmApp(): Promise<App | null> {
  if (_app) return _app
  if (_initFailed) return null
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  if (!b64) return null
  try {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app')
    const credentials = JSON.parse(Buffer.from(b64, 'base64').toString())
    _app = getApps()[0] ?? initializeApp({ credential: cert(credentials) })
    return _app
  } catch (err) {
    console.error('[push-fcm] init failed (check FIREBASE_SERVICE_ACCOUNT_BASE64):', err)
    _initFailed = true
    return null
  }
}

export function fcmConfigured(): boolean {
  return !!process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
}

/**
 * Send one native push to an FCM device token. Returns 'ok', 'stale' (token no
 * longer registered — caller should delete the subscription row), or 'skipped'
 * (FCM not configured / transient failure — keep the row).
 */
export async function sendFcmToToken(
  token: string,
  payload: { title: string; body: string; url?: string },
): Promise<'ok' | 'stale' | 'skipped'> {
  const app = await getFcmApp()
  if (!app) return 'skipped'
  try {
    const { getMessaging } = await import('firebase-admin/messaging')
    await getMessaging(app).send({
      token,
      notification: { title: payload.title, body: payload.body },
      data: payload.url ? { url: payload.url } : undefined,
      apns: { payload: { aps: { sound: 'default' } } },
      android: { priority: 'high' },
    })
    return 'ok'
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code ?? ''
    // Token invalid/rotated/uninstalled → prune the subscription
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
      return 'stale'
    }
    console.error('[push-fcm] send failed:', code || err)
    return 'skipped'
  }
}
