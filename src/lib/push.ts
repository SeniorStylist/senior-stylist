import { db } from '@/db'
import { pushSubscriptions } from '@/db/schema'
import { eq } from 'drizzle-orm'

// Lazy VAPID init — no-op when keys are unset (safe for dev)
let _initialized = false

function initVapid() {
  if (_initialized) return
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!publicKey || !privateKey || !subject) return
  // Dynamic import keeps web-push out of the bundle unless push is actually used
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webpush = require('web-push')
  webpush.setVapidDetails(subject, publicKey, privateKey)
  _initialized = true
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string }
) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return
  initVapid()

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))

  if (subs.length === 0) return

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webpush = require('web-push')
  const body = JSON.stringify(payload)

  await Promise.allSettled(
    subs.map((sub) =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        )
        .catch((err: { statusCode?: number }) => {
          // 410 Gone = subscription expired, clean it up
          if (err?.statusCode === 410) {
            db.delete(pushSubscriptions)
              .where(eq(pushSubscriptions.id, sub.id))
              .catch(() => {})
          }
        })
    )
  )
}
