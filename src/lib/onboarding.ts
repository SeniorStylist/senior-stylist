// Onboarding/login helpers shared by the invite-redeem and auth-callback paths.
//
// Why heal-on-login exists: all access is gated on a `facility_users` row keyed by
// `auth.uid()`. A stylist who accepts an invite with one auth method (e.g. magic
// link) and later signs in with another (e.g. Google) can land on a DIFFERENT
// Supabase user id with no membership — and once the invite is `used`, redeem can't
// re-provision it, so they're stuck on /unauthorized. `healMembershipOnLogin`
// re-provisions the membership for the current uid from any invite for their email.

import { db } from '@/db'
import { revalidateTag } from 'next/cache'
import { invites, facilityUsers, profiles, stylists, stylistFacilityAssignments } from '@/db/schema'
import { and, desc, eq, ilike, inArray, ne, or, type SQL } from 'drizzle-orm'
import { ensureInviteTrackingSchema } from '@/lib/invite-ddl'

/**
 * Link a user's profile to a stylist directory record by email, then by name.
 * Returns the matched stylist id, or null. Shared by redeem + heal so the two
 * paths never drift.
 *
 * P49 — the lookups accept stylists who work at the facility via a HOME row OR
 * an active `stylist_facility_assignments` row (the canonical P33/P34 roster
 * rule: never query stylists by facility_id alone). The old home-only match
 * made auto-linking STRUCTURALLY impossible for assignment-linked stylists —
 * Senait at F177 could never link no matter which email she signed in with,
 * which is how her second login ended up permanently view-only.
 *
 * Claim guard: a stylist already linked to ANOTHER profile is never stolen —
 * mirrors the 409 takeover guards on the manual assign routes.
 */
export async function linkStylistByEmailOrName(
  userId: string,
  facilityId: string,
  email: string | null | undefined,
  fullName: string | null | undefined,
): Promise<string | null> {
  const userEmail = email?.toLowerCase().trim() ?? ''
  const userFullName = (fullName ?? '').trim()
  if (!userEmail && !userFullName) return null

  const assignedRows = await db
    .select({ stylistId: stylistFacilityAssignments.stylistId })
    .from(stylistFacilityAssignments)
    .where(
      and(
        eq(stylistFacilityAssignments.facilityId, facilityId),
        eq(stylistFacilityAssignments.active, true),
      ),
    )
  const assignedIds = assignedRows.map((a) => a.stylistId)
  const worksHere: SQL =
    assignedIds.length > 0
      ? or(eq(stylists.facilityId, facilityId), inArray(stylists.id, assignedIds))!
      : eq(stylists.facilityId, facilityId)

  let matched = userEmail
    ? await db.query.stylists.findFirst({
        where: and(worksHere, eq(stylists.active, true), ilike(stylists.email, userEmail)),
      })
    : null

  if (!matched && userFullName) {
    matched = await db.query.stylists.findFirst({
      where: and(worksHere, eq(stylists.active, true), ilike(stylists.name, userFullName)),
    })
  }

  if (matched) {
    // Never steal a stylist another login already holds (duplicate-account
    // safety — the OTHER account keeps working; this one stays unlinked and
    // the P48 banner/request-link flow takes over).
    const alreadyClaimed = await db.query.profiles.findFirst({
      where: and(eq(profiles.stylistId, matched.id), ne(profiles.id, userId)),
      columns: { id: true },
    })
    if (alreadyClaimed) return null
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
  // P31 — bust the cached layout membership list (best-effort: this helper is
  // called from the auth-callback route handler where revalidateTag is valid).
  try { revalidateTag('facilities', {}) } catch { /* non-request context */ }

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
