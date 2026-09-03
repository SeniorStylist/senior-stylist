// Onboarding/login helpers shared by the invite-redeem and auth-callback paths.
//
// Why heal-on-login exists: all access is gated on a `facility_users` row keyed by
// `auth.uid()`. A stylist who accepts an invite with one auth method (e.g. magic
// link) and later signs in with another (e.g. Google) can land on a DIFFERENT
// Supabase user id with no membership — and once the invite is `used`, redeem can't
// re-provision it, so they're stuck on /unauthorized. `healMembershipOnLogin`
// re-provisions memberships for the current uid from EVERY invite for their
// email — P57: a second-facility invite used to be invisible because the old
// version stopped as soon as the uid was a member anywhere.

import { db } from '@/db'
import { revalidateTag } from 'next/cache'
import { invites, facilityUsers, profiles, stylists, stylistFacilityAssignments } from '@/db/schema'
import { and, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm'
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

/**
 * P57 — link a profile to the EXACT stylist record an invite was sent for.
 *
 * Why: `invites.stylist_id` now records which directory row the stylist-invite
 * route mailed. Before it existed, redemption re-derived the record by email
 * then by FUZZY NAME — so two stylists with similar names could swap records,
 * and a stylist who accepted at a different address than the one on file
 * linked to nothing at all. Deterministic id beats re-derivation.
 *
 * Returns the linked stylist id, or null when the record is gone/inactive or
 * another profile already holds it (same never-steal guard as the by-name path).
 */
export async function linkStylistRecordById(
  userId: string,
  stylistId: string,
  facilityId: string,
): Promise<string | null> {
  // Same home-OR-active-assignment scope the heuristic path enforces (P33). The
  // stylist-invite route anchors the invite at the CALLER's facility, so a
  // franchise admin inviting a pool stylist can name a record that does not
  // work at that facility; linking it anyway would put the person in a silently
  // empty day log instead of P48's explanatory "not linked" state.
  const assignedRows = await db
    .select({ stylistId: stylistFacilityAssignments.stylistId })
    .from(stylistFacilityAssignments)
    .where(
      and(eq(stylistFacilityAssignments.facilityId, facilityId), eq(stylistFacilityAssignments.active, true)),
    )
  const assignedIds = assignedRows.map((a) => a.stylistId)
  const worksHere: SQL =
    assignedIds.length > 0
      ? or(eq(stylists.facilityId, facilityId), inArray(stylists.id, assignedIds))!
      : eq(stylists.facilityId, facilityId)

  const stylist = await db.query.stylists.findFirst({
    // Active check is the staleness guard: the record may have been
    // deactivated between sending the invite and accepting it.
    where: and(eq(stylists.id, stylistId), eq(stylists.active, true), worksHere),
    columns: { id: true },
  })
  if (!stylist) return null

  const alreadyClaimed = await db.query.profiles.findFirst({
    where: and(eq(profiles.stylistId, stylist.id), ne(profiles.id, userId)),
    columns: { id: true },
  })
  if (alreadyClaimed) return null

  await db.update(profiles).set({ stylistId: stylist.id, updatedAt: new Date() }).where(eq(profiles.id, userId))
  return stylist.id
}

type AuthUserLike = {
  id: string
  email?: string | null
  user_metadata?: { full_name?: string | null; avatar_url?: string | null }
}

/**
 * If a just-authenticated user was invited (used OR unused), provision a
 * `facility_users` row + profile + stylist link for the CURRENT auth uid at
 * EVERY invited facility they aren't already a member of. Idempotent; safe
 * because Supabase has verified the user's email and an admin previously
 * invited it. Returns a facilityId they now belong to, else null.
 *
 * P57 — this used to bail the moment the uid had a membership ANYWHERE. A
 * stylist invited to a second facility (or whose older invite provisioned
 * facility A while the new one is for facility B) could never be provisioned
 * for B: redeem refuses a `used` invite, and heal saw "already a member" and
 * returned. They signed in and simply did not see the facility.
 *
 * Query budget (max:1 pool — never a per-invite loop): one read of the invites
 * for this email, one read of the uid's memberships, one batched insert, one
 * verification read, and at most ONE stylist-link attempt.
 */
export async function healMembershipOnLogin(user: AuthUserLike): Promise<string | null> {
  const email = user.email?.toLowerCase().trim()
  if (!email) return null

  await ensureInviteTrackingSchema()

  const [invited, memberships] = await Promise.all([
    // Exact, case-insensitive equality — NOT ilike. `_` and `%` are legal in an
    // email local part and LIKE treats them as wildcards, so `mary_smith@…`
    // also matched `mary.smith@…`; with the multi-facility pass below that
    // would hand one person memberships at a stranger's invited facilities.
    db.query.invites.findMany({
      where: sql`lower(${invites.email}) = ${email}`,
      orderBy: [desc(invites.createdAt)],
      columns: { facilityId: true, inviteRole: true, stylistId: true, used: true, expiresAt: true },
    }),
    db
      .select({ facilityId: facilityUsers.facilityId })
      .from(facilityUsers)
      .where(eq(facilityUsers.userId, user.id)),
  ])

  // Existing membership wins the return value so a returning user's
  // selected_facility_id cookie behaviour is unchanged by the new pass.
  const currentFacilityId = memberships[0]?.facilityId ?? null
  if (invited.length === 0) return currentFacilityId

  const memberFacilityIds = new Set(memberships.map((m) => m.facilityId))
  // The ADDITIONAL-facility pass requires a LIVE invite (unused, unexpired).
  // Accepting a spent one would silently undo removals: Settings -> Team leaves
  // the accepted `used=true` row in the table forever, so a removed member who
  // still works at another facility would be re-provisioned on their very next
  // sign-in. The original zero-membership case below keeps the P48/P49
  // used-or-unused semantics — there is nothing to undo when the uid has no
  // memberships at all.
  const hasAnyMembership = memberships.length > 0
  const now = new Date()
  const isLive = (inv: (typeof invited)[number]) =>
    !inv.used && !!inv.expiresAt && inv.expiresAt.getTime() > now.getTime()

  // Newest invite per facility (the list is createdAt DESC), skipping any
  // facility this uid already belongs to.
  const toProvision = new Map<string, (typeof invited)[number]>()
  for (const inv of invited) {
    if (memberFacilityIds.has(inv.facilityId) || toProvision.has(inv.facilityId)) continue
    if (hasAnyMembership && !isLive(inv)) continue
    toProvision.set(inv.facilityId, inv)
  }
  if (toProvision.size === 0) return currentFacilityId

  const pending = [...toProvision.values()]

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
    .values(
      pending.map((inv) => ({
        userId: user.id,
        facilityId: inv.facilityId,
        role: inv.inviteRole || 'stylist',
      })),
    )
    .onConflictDoNothing()
  // P31 — bust the cached layout membership list (best-effort: this helper is
  // called from the auth-callback route handler where revalidateTag is valid).
  try { revalidateTag('facilities', {}) } catch { /* non-request context */ }

  // Re-check the rows persisted — surface a transient insert failure rather
  // than silently leaving the user on /unauthorized.
  const after = await db
    .select({ facilityId: facilityUsers.facilityId })
    .from(facilityUsers)
    .where(eq(facilityUsers.userId, user.id))
  const afterIds = new Set(after.map((r) => r.facilityId))
  const persisted = pending.filter((inv) => afterIds.has(inv.facilityId))
  if (persisted.length === 0) {
    console.error('[healMembershipOnLogin] facility_users insert did not persist', {
      userId: user.id,
      facilityIds: pending.map((inv) => inv.facilityId),
    })
    return currentFacilityId
  }

  // A profile holds ONE stylist link, so attempt it at most once — never once
  // per invited facility. Skip entirely when the profile is already linked.
  const stylistInvites = persisted.filter((inv) => (inv.inviteRole || 'stylist') === 'stylist')
  if (stylistInvites.length > 0) {
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { stylistId: true },
    })
    if (!profile?.stylistId) {
      // P57 — prefer the invite that names its stylist record; fall back to
      // the email-then-name heuristic only when no invite carries one.
      const named = stylistInvites.find((inv) => inv.stylistId)
      const linked =
        named?.stylistId ? await linkStylistRecordById(user.id, named.stylistId, named.facilityId) : null
      if (!linked) {
        await linkStylistByEmailOrName(
          user.id,
          stylistInvites[0].facilityId,
          user.email,
          user.user_metadata?.full_name ?? null,
        )
      }
    }
  }

  return currentFacilityId ?? persisted[0].facilityId
}
