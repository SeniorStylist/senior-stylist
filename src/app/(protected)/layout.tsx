import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { facilityUsers, facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { cookies } from 'next/headers'
import { Sidebar } from '@/components/layout/sidebar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { ToastProvider } from '@/components/ui/toast'
import InstallBanner from '@/components/pwa/install-banner'
import { NavigationProgress } from '@/components/ui/navigation-progress'

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

  // Load all facilities this user belongs to
  let facilityName: string | undefined
  let allFacilities: { id: string; name: string; role: string }[] = []
  let activeRole: string = 'admin'

  try {
    const userFacilities = await db.query.facilityUsers.findMany({
      where: eq(facilityUsers.userId, user.id),
      with: { facility: true },
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    })

    allFacilities = userFacilities
      .filter((fu) => fu.facility != null)
      .map((fu) => ({
        id: fu.facilityId,
        name: fu.facility!.name,
        role: fu.role,
      }))

    // Determine active facility from cookie or first
    const cookieStore = await cookies()
    const selectedId = cookieStore.get('selected_facility_id')?.value
    const active = allFacilities.find((f) => f.id === selectedId) ?? allFacilities[0]
    facilityName = active?.name
    activeRole = active?.role ?? 'admin'
  } catch (err) {
    // DB might not be set up yet — that's OK
    console.error('[layout] Failed to load facility data:', err)
  }

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <NavigationProgress />
      <div className="hidden md:flex">
        <Sidebar user={user} facilityName={facilityName} allFacilities={allFacilities} role={activeRole} />
      </div>
      <main className="main-content flex-1 min-w-0 overflow-auto">
        <ToastProvider>{children}</ToastProvider>
      </main>
      <MobileNav role={activeRole} />
      <InstallBanner />
    </div>
  )
}
