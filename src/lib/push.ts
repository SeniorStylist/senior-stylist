import { db } from '@/db'
import { pushSubscriptions } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { sendFcmToToken } from '@/lib/push-fcm'

let _webPush: typeof import('web-push') | null = null
let _vapidSet = false

async function getWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return null
  if (!_webPush) _webPush = await import('web-push')
  if (!_vapidSet) {
    _webPush.setVapidDetails(subject, publicKey, privateKey)
    _vapidSet = true
  }
  return _webPush
}

/**
 * Send a push to every device a user has opted in on. Two rails (N3):
 *   - platform 'web'         → web-push (VAPID) — no-op when VAPID keys unset
 *   - platform 'ios|android' → FCM (endpoint column holds the device token) —
 *                              no-op when FIREBASE_SERVICE_ACCOUNT_BASE64 unset
 * Stale subscriptions (expired web endpoints / unregistered FCM tokens) are pruned.
 * Never throws — always fire-and-forget safe.
 */
export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  const subs = await db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.userId, userId),
  })
  if (subs.length === 0) return

  const wp = await getWebPush()
  const data = JSON.stringify(payload)
  const stale: string[] = []

  await Promise.allSettled(
    subs.map(async (sub) => {
      const platform = sub.platform ?? 'web'
      if (platform === 'web') {
        if (!wp || !sub.p256dh || !sub.auth) return // VAPID unset or malformed row
        try {
          await wp.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, data)
        } catch (err: unknown) {
          // 404/410 = subscription expired
          if (err && typeof err === 'object' && 'statusCode' in err) {
            const code = (err as { statusCode: number }).statusCode
            if (code === 404 || code === 410) stale.push(sub.endpoint)
          }
        }
      } else {
        // native: endpoint holds the FCM device token
        const result = await sendFcmToToken(sub.endpoint, payload)
        if (result === 'stale') stale.push(sub.endpoint)
      }
    })
  )

  // Remove expired subscriptions
  if (stale.length > 0) {
    for (const endpoint of stale) {
      await db.delete(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, endpoint))
        .catch(() => {})
    }
  }
}
