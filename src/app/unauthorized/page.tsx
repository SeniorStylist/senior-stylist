import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { invites, facilityUsers, profiles } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { SignOutButton } from './sign-out-button'

export default async function UnauthorizedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Default fallback
  let contactEmail =
    process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? 'admin@senior-stylist.vercel.app'

  if (user?.email) {
    // Find any invite for this email to identify their facility
    const invite = await db.query.invites.findFirst({
      where: (t) => eq(t.email, user.email!.toLowerCase()),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    })

    if (invite) {
      const facility = await db.query.facilities.findFirst({
        where: (t) => eq(t.id, invite.facilityId),
      })

      if (facility?.contactEmail) {
        contactEmail = facility.contactEmail
      } else {
        // Fall back to facility admin's email
        const [adminRow] = await db
          .select({ email: profiles.email })
          .from(facilityUsers)
          .innerJoin(profiles, eq(profiles.id, facilityUsers.userId))
          .where(
            and(eq(facilityUsers.facilityId, invite.facilityId), eq(facilityUsers.role, 'admin'))
          )
          .limit(1)

        if (adminRow?.email) {
          contactEmail = adminRow.email
        }
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="bg-white rounded-2xl shadow-xl border border-stone-100 p-10 w-full max-w-sm text-center">
        {/* Icon */}
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ backgroundColor: '#0D2B2E' }}>
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <path d="M14 4C8.477 4 4 8.477 4 14s4.477 10 10 10 10-4.477 10-10S19.523 4 14 4z" fill="#14D9C4" opacity="0.3"/>
            <path d="M14 8c-3.314 0-6 2.686-6 6s2.686 6 6 6 6-2.686 6-6-2.686-6-6-6z" fill="#14D9C4"/>
            <path d="M14 11a1.5 1.5 0 100 3 1.5 1.5 0 000-3z" fill="#0D2B2E"/>
          </svg>
        </div>

        <h1
          className="text-2xl font-bold text-stone-900 mb-1"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Access by invitation only
        </h1>

        {user?.email && (
          <p className="text-sm text-stone-500 mt-2">
            Signed in as <span className="font-medium text-stone-700">{user.email}</span>
          </p>
        )}

        <p className="text-sm text-stone-400 mt-3">
          You don&apos;t have access to Senior Stylist. Please contact your facility administrator for an invitation.
        </p>

        <div className="mt-6 space-y-3">
          <a
            href={`mailto:${contactEmail}?subject=Senior Stylist Access Request&body=Hi, I'd like to request access to Senior Stylist. My email is ${user?.email ?? ''}.`}
            className="block w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ backgroundColor: '#0D7377' }}
          >
            Request access
          </a>
          <SignOutButton />
        </div>
      </div>
    </div>
  )
}
