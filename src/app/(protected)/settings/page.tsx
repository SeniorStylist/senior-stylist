import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilityUsers, accessRequests, stylists } from '@/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { getUserFacility } from '@/lib/get-facility-id'
import { SettingsClient } from './settings-client'

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (facilityUser.role !== 'admin') redirect('/dashboard')

  try {
  const [facility, connectedUsers, pendingRequests] = await Promise.all([
    db.query.facilities.findFirst({
      where: (t, { eq }) => eq(t.id, facilityUser.facilityId),
    }),
    db.query.facilityUsers.findMany({
      where: eq(facilityUsers.facilityId, facilityUser.facilityId),
      with: { profile: true },
    }),
    facilityUser.role === 'admin'
      ? db.query.accessRequests.findMany({
          where: (t) => and(eq(t.facilityId, facilityUser.facilityId), eq(t.status, 'pending')),
        })
      : Promise.resolve([]),
  ])

  if (!facility) redirect('/dashboard')

  // Fetch last_sign_in_at from auth.users for status indicators
  let authMap = new Map<string, string | null>()
  try {
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data: { users: authUsers } } = await adminClient.auth.admin.listUsers()
    authMap = new Map(authUsers.map((u) => [u.id, u.last_sign_in_at ?? null]))
  } catch (err) {
    console.error('[SettingsPage] auth admin listUsers failed:', err)
  }

  // Batch-resolve stylist names for the Team tab display
  const stylistIds = connectedUsers
    .map((cu) => (cu.profile as { stylistId?: string | null } | null)?.stylistId)
    .filter((id): id is string => Boolean(id))
  const stylistNameMap = new Map<string, string>()
  if (stylistIds.length > 0) {
    const stylistRows = await db
      .select({ id: stylists.id, name: stylists.name })
      .from(stylists)
      .where(inArray(stylists.id, stylistIds))
    stylistRows.forEach((s) => stylistNameMap.set(s.id, s.name))
  }

  const usersWithStatus = connectedUsers.map((cu) => {
    const stylistId = (cu.profile as { stylistId?: string | null } | null)?.stylistId
    return {
      ...cu,
      lastSignIn: authMap.get(cu.userId) ?? null,
      stylistName: stylistId ? (stylistNameMap.get(stylistId) ?? null) : null,
    }
  })

  return (
    <SettingsClient
      facility={JSON.parse(JSON.stringify(facility))}
      connectedUsers={JSON.parse(JSON.stringify(usersWithStatus))}
      currentUserId={user.id}
      currentUserEmail={user.email ?? null}
      isAdmin={facilityUser.role === 'admin'}
      pendingRequestsCount={pendingRequests.length}
    />
  )
  } catch (err) {
    console.error('[SettingsPage] DB error:', err)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg mt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">Failed to load settings. Please refresh to try again.</p>
        </div>
      </div>
    )
  }
}
