import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, facilityUsers, profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { ensureInviteTrackingSchema } from '@/lib/invite-ddl'
import { revalidateTag } from 'next/cache'
import { linkStylistByEmailOrName, linkStylistRecordById } from '@/lib/onboarding'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/login', request.url))

  await ensureInviteTrackingSchema()

  // Re-validate token (route handler may be hit directly, so always validate)
  const invite = await db.query.invites.findFirst({ where: eq(invites.token, token) })
  const now = new Date()
  if (!invite || invite.used || new Date(invite.expiresAt) < now) {
    // Send back to page — it will render the "Invalid Invite" error UI
    return NextResponse.redirect(new URL(`/invite/accept?token=${token}`, request.url))
  }

  // Must be authenticated
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(
      new URL(`/login?redirect=/invite/accept?token=${token}`, request.url)
    )
  }

  // Upsert profile
  await db
    .insert(profiles)
    .values({
      id: user.id,
      email: user.email ?? null,
      fullName: user.user_metadata?.full_name ?? null,
      avatarUrl: user.user_metadata?.avatar_url ?? null,
    })
    .onConflictDoUpdate({
      target: profiles.id,
      set: {
        email: user.email ?? null,
        fullName: user.user_metadata?.full_name ?? null,
        avatarUrl: user.user_metadata?.avatar_url ?? null,
        updatedAt: new Date(),
      },
    })

  // Insert facilityUser (no-op if already exists)
  await db
    .insert(facilityUsers)
    .values({
      userId: user.id,
      facilityId: invite.facilityId,
      role: invite.inviteRole || 'stylist',
    })
    .onConflictDoNothing()
  // P31 — bust the cached layout membership list so the new facility appears
  // in the sidebar/switcher immediately.
  revalidateTag('facilities', {})

  // Mark invite as used + record acceptance (and viewing, if the open-time
  // stamp was missed because the user was already authenticated)
  await db
    .update(invites)
    .set({ used: true, acceptedAt: now, viewedAt: invite.viewedAt ?? now })
    .where(eq(invites.id, invite.id))

  // Set selected_facility_id cookie — Route Handlers can mutate cookies
  const cookieStore = await cookies()
  cookieStore.set('selected_facility_id', invite.facilityId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })

  const role = invite.inviteRole || 'stylist'

  // Stylist: auto-link to a stylist record. P57 — the invite now names the
  // record it was sent for, so link that exact row first; the old email-then-
  // fuzzy-name derivation linked look-alike names to each other and missed
  // stylists who accepted at a different address than the one on file. Falls
  // back to the heuristic for team invites and pre-P57 rows (stylistId null).
  // Both paths share the never-steal guard (a record another profile already
  // holds is left alone).
  if (role === 'stylist') {
    // Only the INVITED identity gets the deterministic link. An accept link can
    // be forwarded or pasted into a group chat (the documented "Copy link"
    // fallback when email delivery fails), and handing a specific stylist's
    // record to whoever opens it would confer their day log and their bookings.
    // A different redeemer falls back to the email/name heuristic, which is
    // self-scoping.
    const invitedSelf = (user.email ?? '').toLowerCase().trim() === invite.email.toLowerCase().trim()
    const linked =
      invite.stylistId && invitedSelf
        ? await linkStylistRecordById(user.id, invite.stylistId, invite.facilityId)
        : null
    if (!linked) {
      await linkStylistByEmailOrName(user.id, invite.facilityId, user.email, user.user_metadata?.full_name ?? null)
    }
    return NextResponse.redirect(new URL('/my-account?welcome=1', request.url))
  }

  return NextResponse.redirect(new URL('/dashboard', request.url))
}
