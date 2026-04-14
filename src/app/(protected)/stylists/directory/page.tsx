import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { stylists, facilities, franchiseFacilities } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { and, eq, inArray, or, isNull } from 'drizzle-orm'
import { sanitizeStylists } from '@/lib/sanitize'
import { DirectoryClient } from './directory-client'

export default async function StylistDirectoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) redirect('/dashboard')
  if (facilityUser.role !== 'admin') redirect('/dashboard')

  const franchise = await getUserFranchise(user.id)

  if (!franchise) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1
          className="text-2xl font-bold text-stone-900 mb-2"
          style={{ fontFamily: "'DM Serif Display', serif" }}
        >
          Directory
        </h1>
        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-6 mt-6">
          <p className="text-sm text-stone-700">
            The stylist directory is available for franchise facilities. This facility isn&apos;t
            part of a franchise yet — contact your administrator to set one up.
          </p>
        </div>
      </div>
    )
  }

  const [stylistsList, franchiseFacilitiesList] = await Promise.all([
    db.query.stylists.findMany({
      where: and(
        eq(stylists.active, true),
        or(
          eq(stylists.franchiseId, franchise.franchiseId),
          franchise.facilityIds.length > 0
            ? and(isNull(stylists.franchiseId), inArray(stylists.facilityId, franchise.facilityIds))
            : undefined,
        ),
      ),
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
    db
      .select({ id: facilities.id, name: facilities.name })
      .from(facilities)
      .innerJoin(franchiseFacilities, eq(franchiseFacilities.facilityId, facilities.id))
      .where(eq(franchiseFacilities.franchiseId, franchise.franchiseId))
      .orderBy(facilities.name),
  ])

  return (
    <DirectoryClient
      initialStylists={JSON.parse(JSON.stringify(sanitizeStylists(stylistsList)))}
      franchiseFacilities={JSON.parse(JSON.stringify(franchiseFacilitiesList))}
      franchiseName={franchise.franchiseName}
    />
  )
}
