import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilityUsers } from '@/db/schema'
import { eq } from 'drizzle-orm'
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

  const [facility, connectedUsers] = await Promise.all([
    db.query.facilities.findFirst({
      where: (t, { eq }) => eq(t.id, facilityUser.facilityId),
    }),
    db.query.facilityUsers.findMany({
      where: eq(facilityUsers.facilityId, facilityUser.facilityId),
      with: { profile: true },
    }),
  ])

  if (!facility) redirect('/dashboard')

  return (
    <SettingsClient
      facility={JSON.parse(JSON.stringify(facility))}
      connectedUsers={JSON.parse(JSON.stringify(connectedUsers))}
      currentUserId={user.id}
      isAdmin={facilityUser.role === 'admin'}
    />
  )
}
