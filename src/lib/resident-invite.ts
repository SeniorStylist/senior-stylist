// P60 — the walk-in "finish your account" family invite, extracted from the
// inline block in POST /api/bookings.
//
// THE bug it fixes: there are TWO walk-in create paths. The offline/stylist
// path creates the resident inline with the booking (bookings POST's
// newResident branch) and mailed the family a magic link; the ADMIN/front-desk
// path POSTs /api/residents and mailed nothing — so the day-log hint "we'll
// email the family" was a lie for admins ever since P54 added the email
// capture there. One helper, both call sites.

import { db } from '@/db'
import { facilities, residents } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
import { createMagicLink } from '@/lib/portal-auth'
import { buildPortalMagicLinkEmailHtml, sendEmail } from '@/lib/email'

const EXPIRES_IN_HOURS = 72
// The send is awaited (see below), so it sits on the caller's response path.
// sendEmail has no internal timeout, and a hung Resend connection is not an
// error it can swallow — without this ceiling a stalled send turns a resident
// that WAS created into a client-visible failure, and the retry makes a
// duplicate (POST /api/residents has no create-dedup).
const SEND_TIMEOUT_MS = 6000

/**
 * Emails a freshly-created resident's family a portal magic link so they can
 * finish setting up their Salon Account.
 *
 * AWAITED, not fire-and-forget: an unawaited send is frozen with the lambda
 * before Resend fires (the June 2026 invite-not-delivered bug), so the caller
 * must await this. It is still NON-FATAL — it NEVER throws and returns false
 * instead, because the resident/booking row is already written by the time we
 * get here and a mail failure must not turn a 201 into a 500.
 *
 * No-ops (returns false) when the resident has no family email, is a demo
 * record, or the facility has no F-code to build the /family link from.
 */
export async function sendFinishAccountInvite(residentId: string): Promise<boolean> {
  try {
    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, residentId),
      columns: { id: true, name: true, facilityId: true, poaEmail: true, isDemo: true },
    })
    // Demo guard is duplicated here as well as at both call sites: a tutorial
    // seed must never mail a real family, whichever path created it.
    if (!resident || !resident.poaEmail || resident.isDemo) return false

    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, resident.facilityId),
      columns: { name: true, facilityCode: true },
    })
    // The magic link is /family/<code>/auth/verify — without an F-code there is
    // no portal to send them to.
    if (!facility?.facilityCode) return false

    const link = await createMagicLink(resident.poaEmail, resident.id, facility.facilityCode, EXPIRES_IN_HOURS)

    const ok = await Promise.race([
      sendEmail({
        to: resident.poaEmail,
        subject: `Finish setting up your ${facility.name} salon account`,
        html: buildPortalMagicLinkEmailHtml({
          residentNames: [resident.name],
          facilityName: facility.name,
          link,
          expiresInHours: EXPIRES_IN_HOURS,
        }),
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SEND_TIMEOUT_MS)),
    ])

    // Stamp the cooldown ledger every other magic-link sender writes
    // (send-invite, link-account, bulk-invite). Without it this invite is
    // invisible to the 24h Send Link and 7-day bulk-invite cooldowns, so the
    // same family gets a SECOND live credential days later.
    if (ok) {
      await db
        .update(residents)
        .set({ lastPortalInviteSentAt: sql`now()` })
        .where(eq(residents.id, resident.id))
        .catch(() => {})
    }
    return ok
  } catch (err) {
    console.error('[resident-invite] finish-account invite failed:', err)
    return false
  }
}
