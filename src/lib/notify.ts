// In-app notification inbox + push, in one call (Phase 15 F1).
// notifyUser inserts a `notifications` row (drives the bell) AND sends a push.
// Everything here is fire-and-forget safe: never throws, mirrors push.ts.
//
// max:1 pool rule: the fan-out helpers below do ONE lookup query + ONE batched
// insert — never a per-recipient query loop. Keep it that way.
//
// Volume note: nightly schedule reminders insert a row per working stylist. If the
// table ever needs pruning, add a 90-day cleanup to an existing cron (not built yet).

import { db } from '@/db'
import { facilityUsers, notifications, profiles } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { ensureNotificationsSchema } from '@/lib/notifications-ddl'
import { sendPushToUser } from '@/lib/push'

export type NotificationType =
  | 'booking_created'
  | 'booking_rescheduled'
  | 'booking_cancelled'
  | 'schedule_reminder'
  | 'coverage_request'
  | 'coverage_decision'
  | 'birthday'
  | 'waitlist_slot_opened'
  | 'payment_failed'
  | 'autopay_summary'
  | 'feedback_received'

export interface NotifyPayload {
  type: NotificationType
  title: string
  body: string
  url?: string
  facilityId?: string | null
}

/** Insert an inbox row + push to one user. Never throws. */
export async function notifyUser(userId: string, p: NotifyPayload): Promise<void> {
  try {
    await ensureNotificationsSchema()
    await db.insert(notifications).values({
      userId,
      facilityId: p.facilityId ?? null,
      type: p.type,
      title: p.title,
      body: p.body,
      url: p.url ?? null,
    })
  } catch (err) {
    console.error('[notifyUser] insert failed:', err)
  }
  // Push is independently best-effort (sendPushToUser never throws).
  await sendPushToUser(userId, { title: p.title, body: p.body, url: p.url })
}

/**
 * Batched multi-recipient variant: ONE insert + N pushes.
 * Use this from crons/fan-outs — never call notifyUser in a loop.
 */
export async function notifyManyUsers(rows: { userId: string; payload: NotifyPayload }[]): Promise<void> {
  if (rows.length === 0) return
  try {
    await ensureNotificationsSchema()
    await db.insert(notifications).values(
      rows.map((r) => ({
        userId: r.userId,
        facilityId: r.payload.facilityId ?? null,
        type: r.payload.type,
        title: r.payload.title,
        body: r.payload.body,
        url: r.payload.url ?? null,
      })),
    )
  } catch (err) {
    console.error('[notifyManyUsers] insert failed:', err)
  }
  await Promise.allSettled(
    rows.map((r) => sendPushToUser(r.userId, { title: r.payload.title, body: r.payload.body, url: r.payload.url })),
  )
}

/**
 * Notify every admin of a facility. ONE facilityUsers×profiles join
 * (facility_users_facility_role_idx) + ONE batched insert. Never throws.
 */
export async function notifyFacilityAdmins(facilityId: string, p: NotifyPayload): Promise<void> {
  try {
    const admins = await db
      .select({ userId: facilityUsers.userId })
      .from(facilityUsers)
      .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
      .where(and(eq(facilityUsers.facilityId, facilityId), eq(facilityUsers.role, 'admin')))
    await notifyManyUsers(
      admins.map((a) => ({ userId: a.userId, payload: { ...p, facilityId } })),
    )
  } catch (err) {
    console.error('[notifyFacilityAdmins] failed:', err)
  }
}
