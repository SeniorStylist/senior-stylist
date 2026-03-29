import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, facilityUsers, profiles, stylists } from '@/db/schema'
import { eq, and, gt, ilike } from 'drizzle-orm'

interface Props {
  searchParams: Promise<{ token?: string }>
}

export default async function InviteAcceptPage({ searchParams }: Props) {
  const { token } = await searchParams

  // Look up invite by token
  const invite = token
    ? await db.query.invites.findFirst({
        where: eq(invites.token, token),
      })
    : null

  const now = new Date()

  const isInvalid =
    !invite ||
    invite.used ||
    new Date(invite.expiresAt) < now

  if (isInvalid) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="bg-white rounded-2xl shadow-xl border border-stone-100 p-10 w-full max-w-sm text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 bg-red-50">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h1
            className="text-xl font-bold text-stone-900 mb-2"
            style={{ fontFamily: "'DM Serif Display', serif" }}
          >
            Invalid Invite
          </h1>
          <p className="text-sm text-stone-500">
            This invite link is invalid or has expired.
          </p>
          <a
            href="/login"
            className="mt-6 inline-block text-sm font-semibold text-[#0D7377] hover:underline"
          >
            Go to login
          </a>
        </div>
      </div>
    )
  }

  // Check if user is logged in
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/login?next=/invite/accept?token=${token}`)
  }

  // Valid — upsert profile, add facilityUser, mark invite used
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
      set: { email: user.email ?? null, fullName: user.user_metadata?.full_name ?? null, avatarUrl: user.user_metadata?.avatar_url ?? null, updatedAt: new Date() },
    })

  // Insert facilityUser (ignore if already exists)
  await db
    .insert(facilityUsers)
    .values({
      userId: user.id,
      facilityId: invite.facilityId,
      role: invite.inviteRole || 'stylist',
    })
    .onConflictDoNothing()

  // Mark invite as used
  await db
    .update(invites)
    .set({ used: true })
    .where(eq(invites.id, invite.id))

  const role = invite.inviteRole || 'stylist'

  // For stylists: try auto-linking to a stylist record by name match
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
        await db.update(profiles)
          .set({ stylistId: matched.id, updatedAt: new Date() })
          .where(eq(profiles.id, user.id))
      }
    }
    redirect('/my-account?welcome=1')
  }

  redirect('/dashboard')
}
