import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilityUsers, accessRequests } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
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

  return (
    <SettingsClient
      facility={JSON.parse(JSON.stringify(facility))}
      connectedUsers={JSON.parse(JSON.stringify(connectedUsers))}
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
