// P48 — "Ask my admin to link me".
//
// A stylist whose login has no linked stylist record hits a hard wall: P30
// fails closed, so /log is view-only and the Scan-log-sheet button can't do
// anything. Senait Edwards reported this twice as "it's not working" because
// from her side the feature is simply absent. This route turns that dead end
// into self-service: one tap bells + emails the facility's admins, who fix it
// in Settings → Team → Assign stylist.
//
// Only reachable BY an unlinked stylist FOR their own facility — there is no
// body, so nothing here is caller-controlled.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { profiles, facilities, facilityUsers } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { getEffectiveStylistId } from '@/lib/effective-stylist'
import { notifyFacilityAdmins } from '@/lib/notify'
import { sendEmail, buildStylistLinkRequestEmailHtml } from '@/lib/email'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'stylist') {
      return Response.json({ error: 'Only stylists can request a stylist link.' }, { status: 403 })
    }

    // Already linked → nothing to ask for (also stops a linked stylist from
    // pinging admins).
    const effective = await getEffectiveStylistId(user.id)
    if (effective) {
      return Response.json({ error: "Your account is already linked — try reloading the page." }, { status: 409 })
    }

    const rl = await checkRateLimit('stylistLinkRequest', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const [profile, facility, admins] = await Promise.all([
      db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { fullName: true, email: true },
      }),
      db.query.facilities.findFirst({
        where: eq(facilities.id, facilityUser.facilityId),
        columns: { name: true },
      }),
      // ONE join for the admin emails (mirrors the compliance-alerts cron).
      db
        .select({ email: profiles.email })
        .from(facilityUsers)
        .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
        .where(and(eq(facilityUsers.facilityId, facilityUser.facilityId), eq(facilityUsers.role, 'admin'))),
    ])
    const who = profile?.fullName ?? profile?.email ?? user.email ?? 'A stylist'
    const email = profile?.email ?? user.email ?? ''
    const facilityName = facility?.name ?? 'your facility'

    // Bell + push for every admin at the facility (ONE join + ONE insert).
    await notifyFacilityAdmins(facilityUser.facilityId, {
      type: 'stylist_link_request',
      title: 'Link a stylist account',
      body: `${who} needs their login linked to a stylist record — their daily log is view-only until then.`,
      url: '/settings?section=team',
    })

    // Email too — the bell alone can sit unread for days and they're blocked now.
    // Awaited: this send IS the action (the P37 unawaited-invite bug).
    const adminEmails = [...new Set(admins.map((a) => a.email).filter((e): e is string => !!e))]
    if (adminEmails.length > 0) {
      const subject = `Action needed: link ${who}'s stylist account`
      const html = buildStylistLinkRequestEmailHtml({ stylistName: who, stylistEmail: email, facilityName })
      // sendEmail takes ONE recipient — await them all together so the lambda
      // can't freeze mid-send (Resend calls are the work here, not a side effect).
      await Promise.all(
        adminEmails.map((to) =>
          sendEmail({ to, subject, html }).catch((err) => {
            console.error('[request-stylist-link] send failed:', err)
            return false
          }),
        ),
      )
    }

    return Response.json({ data: { notified: adminEmails.length } })
  } catch (err) {
    console.error('POST /api/profile/request-stylist-link error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
