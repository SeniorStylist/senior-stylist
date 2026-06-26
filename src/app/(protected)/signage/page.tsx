import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { SignageClient } from './signage-client'

export const dynamic = 'force-dynamic'

export default async function SignagePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const fu = await getUserFacility(user.id)
  if (!fu) redirect('/dashboard')
  // Admin (incl. normalized super_admin) + facility_staff. Stylists/bookkeepers don't manage signage.
  if (fu.role !== 'admin' && fu.role !== 'super_admin' && fu.role !== 'facility_staff') redirect('/dashboard')

  const facility = await db.query.facilities.findFirst({
    where: eq(facilities.id, fu.facilityId),
    columns: { name: true, phone: true },
  })

  return <SignageClient facilityName={facility?.name ?? 'Our Salon'} facilityPhone={facility?.phone ?? null} />
}
