import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { InviteAcceptClient } from './invite-accept-client'

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
            className="mt-6 inline-block text-sm font-semibold text-[#8B2E4A] hover:underline"
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
    // Not authenticated — show the client-side auth UI
    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, invite.facilityId),
    })
    return (
      <InviteAcceptClient
        token={token!}
        facilityName={facility?.name ?? 'Senior Stylist'}
        inviteRole={invite.inviteRole || 'stylist'}
        inviteEmail={invite.email}
      />
    )
  }

  // Valid & authenticated — hand off to route handler which can set cookies
  redirect(`/api/invite/redeem?token=${token!}`)
}
