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

  const servicesList = await db.query.services.findMany({
    where: and(
      eq(services.facilityId, facilityUser.facilityId),
      eq(services.active, true)
    ),
    orderBy: (t, { asc }) => [asc(t.name)],
  })

  return (
    <ServicesPageClient services={JSON.parse(JSON.stringify(servicesList))} />
  )
}
