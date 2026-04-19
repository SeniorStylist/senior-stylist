import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { services } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { ServicesPageClient } from './services-page-client'

export default async function ServicesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (facilityUser.role !== 'admin') redirect('/dashboard')

  try {
  const servicesList = await db.query.services.findMany({
    where: and(
      eq(services.facilityId, facilityUser.facilityId),
      eq(services.active, true)
    ),
    orderBy: (t, { asc, desc }) => [desc(t.category), asc(t.name)],
  })

  return (
    <ServicesPageClient services={JSON.parse(JSON.stringify(servicesList))} />
  )
  } catch (err) {
    console.error('[ServicesPage] DB error:', err)
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 max-w-lg mt-4">
          <p className="text-sm font-semibold text-red-700 mb-1">Something went wrong</p>
          <p className="text-xs text-red-600">Failed to load services. Please refresh to try again.</p>
        </div>
      </div>
    )
  }
}
