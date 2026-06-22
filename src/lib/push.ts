import { db } from '@/db'
import { pushSubscriptions } from '@/db/schema'
import { eq } from 'drizzle-orm'

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

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  const wp = await getWebPush()
  if (!wp) return // no-op when VAPID keys unset

  const subs = await db.query.pushSubscriptions.findMany({
    where: eq(pushSubscriptions.userId, userId),
  })

  const data = JSON.stringify(payload)
  const stale: string[] = []

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await wp.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, data)
      } catch (err: unknown) {
        // 404/410 = subscription expired
        if (err && typeof err === 'object' && 'statusCode' in err) {
          const code = (err as { statusCode: number }).statusCode
          if (code === 404 || code === 410) stale.push(sub.endpoint)
        }
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
