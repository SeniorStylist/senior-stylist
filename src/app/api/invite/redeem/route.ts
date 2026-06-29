import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, facilityUsers, profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { ensureInviteTrackingSchema } from '@/lib/invite-ddl'
import { linkStylistByEmailOrName } from '@/lib/onboarding'

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

  // Stylist: auto-link to a stylist record — try email first, fall back to name
  // (shared helper, also used by the heal-on-login path so the logic never drifts).
  if (role === 'stylist') {
    await linkStylistByEmailOrName(user.id, invite.facilityId, user.email, user.user_metadata?.full_name ?? null)
    return NextResponse.redirect(new URL('/my-account?welcome=1', request.url))
  }

  return NextResponse.redirect(new URL('/dashboard', request.url))
}
