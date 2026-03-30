import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/db'
import { residents, stylists, bookings, facilityUsers, accessRequests, facilities, franchises } from '@/db/schema'
import { eq, and, gte, count } from 'drizzle-orm'
import { SuperAdminClient } from './super-admin-client'

interface FacilityInfo {
  id: string
  name: string
  address: string | null
  phone: string | null
  timezone: string
  paymentType: string
  contactEmail: string | null
  active: boolean
  createdAt: string | null
  residentCount: number
  stylistCount: number
  bookingsThisMonth: number
  adminEmail: string | null
}

export default async function SuperAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) {
    redirect('/dashboard')
  }

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  // Load all facilities + pending requests + active facilities list + franchises in parallel
  const [allFacilities, pendingRequests, activeFacilitiesList, franchiseList] = await Promise.all([
    db.query.facilities.findMany({
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    }),
    db.query.accessRequests.findMany({
      where: (t) => eq(t.status, 'pending'),
      orderBy: (t, { desc }) => [desc(t.createdAt)],
    }),
    db.query.facilities.findMany({
      where: (t) => eq(t.active, true),
      orderBy: (t, { asc }) => [asc(t.name)],
      columns: { id: true, name: true },
    }),
    db.query.franchises.findMany({
      with: {
        owner: { columns: { email: true, fullName: true } },
        franchiseFacilities: {
          with: { facility: { columns: { id: true, name: true } } },
        },
      },
      orderBy: (t, { asc }) => [asc(t.name)],
    }),
  ])

  // For each facility, get counts
  const facilityInfos: FacilityInfo[] = await Promise.all(
    allFacilities.map(async (f) => {
      const [resCount, styCount, bookCount, adminUser] = await Promise.all([
        db.select({ count: count() }).from(residents).where(and(eq(residents.facilityId, f.id), eq(residents.active, true))),
        db.select({ count: count() }).from(stylists).where(and(eq(stylists.facilityId, f.id), eq(stylists.active, true))),
        db.select({ count: count() }).from(bookings).where(and(eq(bookings.facilityId, f.id), gte(bookings.startTime, monthStart))),
        db.query.facilityUsers.findFirst({
          where: and(eq(facilityUsers.facilityId, f.id), eq(facilityUsers.role, 'admin')),
          with: { profile: true },
        }),
      ])

      return {
        id: f.id,
        name: f.name,
        address: f.address,
        phone: f.phone,
        timezone: f.timezone,
        paymentType: f.paymentType,
        contactEmail: f.contactEmail ?? null,
        active: f.active,
        createdAt: f.createdAt?.toISOString() ?? null,
        residentCount: resCount[0]?.count ?? 0,
        stylistCount: styCount[0]?.count ?? 0,
        bookingsThisMonth: bookCount[0]?.count ?? 0,
        adminEmail: adminUser?.profile?.email ?? null,
      }
    })
  )

  return (
    <SuperAdminClient
      facilities={facilityInfos}
      pendingRequests={pendingRequests.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.fullName,
        role: r.role,
        status: r.status,
        userId: r.userId,
        createdAt: r.createdAt?.toISOString() ?? null,
      }))}
      activeFacilities={activeFacilitiesList}
      franchises={franchiseList.map((f) => ({
        id: f.id,
        name: f.name,
        ownerEmail: f.owner?.email ?? null,
        ownerName: f.owner?.fullName ?? null,
        facilities: f.franchiseFacilities.map((ff) => ({
          id: ff.facility.id,
          name: ff.facility.name,
        })),
      }))}
    />
  )
}
