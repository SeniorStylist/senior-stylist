// Onboarding/login helpers shared by the invite-redeem and auth-callback paths.
//
// Why heal-on-login exists: all access is gated on a `facility_users` row keyed by
// `auth.uid()`. A stylist who accepts an invite with one auth method (e.g. magic
// link) and later signs in with another (e.g. Google) can land on a DIFFERENT
// Supabase user id with no membership — and once the invite is `used`, redeem can't
// re-provision it, so they're stuck on /unauthorized. `healMembershipOnLogin`
// re-provisions the membership for the current uid from any invite for their email.

import { db } from '@/db'
import { invites, facilityUsers, profiles, stylists } from '@/db/schema'
import { and, desc, eq, ilike } from 'drizzle-orm'
import { ensureInviteTrackingSchema } from '@/lib/invite-ddl'

/**
 * Link a user's profile to a stylist directory record by email, then by name.
 * Returns the matched stylist id, or null. Shared by redeem + heal so the two
 * paths never drift.
 */
export async function linkStylistByEmailOrName(
  userId: string,
  facilityId: string,
  email: string | null | undefined,
  fullName: string | null | undefined,
): Promise<string | null> {
  const userEmail = email?.toLowerCase().trim() ?? ''
  const userFullName = (fullName ?? '').trim()

  let matched = userEmail
    ? await db.query.stylists.findFirst({
        where: and(eq(stylists.facilityId, facilityId), eq(stylists.active, true), ilike(stylists.email, userEmail)),
      })
    : null

  if (!matched && userFullName) {
    matched = await db.query.stylists.findFirst({
      where: and(eq(stylists.facilityId, facilityId), eq(stylists.active, true), ilike(stylists.name, userFullName)),
    })
  }

  if (matched) {
    await db.update(profiles).set({ stylistId: matched.id, updatedAt: new Date() }).where(eq(profiles.id, userId))
    return matched.id
  }
  return null
}

type AuthUserLike = {
  id: string
  email?: string | null
  user_metadata?: { full_name?: string | null; avatar_url?: string | null }
}

/**
 * If a just-authenticated user has no facility membership but their email was
 * invited (used OR unused), provision a `facility_users` row + profile + stylist
 * link for the CURRENT auth uid. Idempotent; safe because Supabase has verified the
 * user's email and an admin previously invited it. Returns the facilityId provisioned
 * (or already a member of), else null.
 */
export async function healMembershipOnLogin(user: AuthUserLike): Promise<string | null> {
  const email = user.email?.toLowerCase().trim()
  if (!email) return null

  // Already a member → nothing to heal.
  const existing = await db.query.facilityUsers.findFirst({
    where: eq(facilityUsers.userId, user.id),
    columns: { facilityId: true },
  })
  if (existing) return existing.facilityId

  await ensureInviteTrackingSchema()

  // Most recent invite for this email (used or unused — `used` only means a prior
  // auth identity accepted it; this uid still needs its own membership).
  const invite = await db.query.invites.findFirst({
    where: ilike(invites.email, email),
    orderBy: [desc(invites.createdAt)],
    columns: { facilityId: true, inviteRole: true },
  })
  if (!invite) return null

  const role = invite.inviteRole || 'stylist'

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

  await db
    .insert(facilityUsers)
    .values({ userId: user.id, facilityId: invite.facilityId, role })
    .onConflictDoNothing()

  // Re-check the row persisted — surface a transient insert failure rather than
  // silently leaving the user on /unauthorized.
  const check = await db.query.facilityUsers.findFirst({
    where: and(eq(facilityUsers.userId, user.id), eq(facilityUsers.facilityId, invite.facilityId)),
    columns: { facilityId: true },
  })
  if (!check) {
    console.error('[healMembershipOnLogin] facility_users insert did not persist', {
      userId: user.id,
      facilityId: invite.facilityId,
    })
    return null
  }

  if (role === 'stylist') {
    await linkStylistByEmailOrName(user.id, invite.facilityId, user.email, user.user_metadata?.full_name ?? null)
  }

  return invite.facilityId
}
