import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, facilityUsers, profiles, stylists } from '@/db/schema'
import { eq, and, ilike } from 'drizzle-orm'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/login', request.url))

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

  // Mark invite as used
  await db.update(invites).set({ used: true }).where(eq(invites.id, invite.id))

  // Set selected_facility_id cookie — Route Handlers can mutate cookies
  const cookieStore = await cookies()
  cookieStore.set('selected_facility_id', invite.facilityId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })

  const role = invite.inviteRole || 'stylist'

  // Stylist: try to auto-link to a stylist record by name match
  if (role === 'stylist') {
    const userFullName = (user.user_metadata?.full_name ?? '').trim()
    if (userFullName) {
      const matched = await db.query.stylists.findFirst({
        where: and(
          eq(stylists.facilityId, invite.facilityId),
          eq(stylists.active, true),
          ilike(stylists.name, userFullName)
        ),
      })
      if (matched) {
        await db
          .update(profiles)
          .set({ stylistId: matched.id, updatedAt: new Date() })
          .where(eq(profiles.id, user.id))
      }
    }
    return NextResponse.redirect(new URL('/my-account?welcome=1', request.url))
  }

  return NextResponse.redirect(new URL('/dashboard', request.url))
}
