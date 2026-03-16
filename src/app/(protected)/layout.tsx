import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilityUsers, facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { Sidebar } from '@/components/layout/sidebar'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Get facility name for sidebar
  let facilityName: string | undefined
  try {
    const facilityUser = await db.query.facilityUsers.findFirst({
      where: eq(facilityUsers.userId, user.id),
    })
    if (facilityUser) {
      const facility = await db.query.facilities.findFirst({
        where: eq(facilities.id, facilityUser.facilityId),
      })
      facilityName = facility?.name
    }
  } catch {
    // DB might not be set up yet — that's OK
  }

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <Sidebar user={user} facilityName={facilityName} />
      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  )
}
