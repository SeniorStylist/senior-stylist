import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { cookies } from 'next/headers'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import { MasterAdminClient } from './master-admin-client'

interface FacilityInfo {
  id: string
  name: string
  facilityCode: string | null
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

const getCachedFacilityInfos = unstable_cache(
  async (yearMonthKey: string): Promise<FacilityInfo[]> => {
    try {
      const [year, month] = yearMonthKey.split('-').map((s) => Number(s))
      const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0)

      // 4 GROUP BY queries instead of 4 × N per-facility queries.
      // With max:1 connection, the per-facility loop serialized through one socket
      // (~120 queries for 30 facilities); this keeps it to 5 queries flat.
      const [allFacilities, residentRows, stylistRows, bookingRows, adminRows] = await Promise.all([
        db.query.facilities.findMany({
          orderBy: (t, { desc }) => [desc(t.createdAt)],
          columns: {
            id: true,
            name: true,
            facilityCode: true,
            address: true,
            phone: true,
            timezone: true,
            paymentType: true,
            contactEmail: true,
            active: true,
            createdAt: true,
          },
        }),
        db.execute(sql`
          SELECT facility_id::text AS fid, COUNT(*)::int AS c
          FROM residents WHERE active = true GROUP BY facility_id
        `),
        db.execute(sql`
          SELECT facility_id::text AS fid, COUNT(*)::int AS c
          FROM stylists WHERE active = true AND facility_id IS NOT NULL
          GROUP BY facility_id
        `),
        db.execute(sql`
          SELECT facility_id::text AS fid, COUNT(*)::int AS c
          FROM bookings
          WHERE start_time >= ${monthStart.toISOString()} AND active = true
          GROUP BY facility_id
        `),
        db.execute(sql`
          SELECT DISTINCT ON (fu.facility_id)
            fu.facility_id::text AS fid, p.email
          FROM facility_users fu
          INNER JOIN profiles p ON p.id = fu.user_id
          WHERE fu.role = 'admin'
          ORDER BY fu.facility_id, fu.created_at ASC
        `),
      ])

      const numMap = (rows: unknown[]): Map<string, number> =>
        new Map(
          rows.map((r) => {
            const row = r as { fid: string; c: number | string }
            return [row.fid, typeof row.c === 'number' ? row.c : Number(row.c)]
          }),
        )
      const strMap = (rows: unknown[], key: string): Map<string, string> =>
        new Map(
          rows.map((r) => {
            const row = r as { fid: string } & Record<string, unknown>
            return [row.fid, (row[key] as string | null) ?? '']
          }),
        )

      const resMap = numMap(residentRows as unknown[])
      const styMap = numMap(stylistRows as unknown[])
      const bookMap = numMap(bookingRows as unknown[])
      const adminMap = strMap(adminRows as unknown[], 'email')

      return allFacilities.map((f) => ({
        id: f.id,
        name: f.name ?? '',
        facilityCode: f.facilityCode ?? null,
        address: f.address,
        phone: f.phone,
        timezone: f.timezone,
        paymentType: f.paymentType,
        contactEmail: f.contactEmail ?? null,
        active: f.active,
        createdAt: f.createdAt?.toISOString() ?? null,
        residentCount: resMap.get(f.id) ?? 0,
        stylistCount: styMap.get(f.id) ?? 0,
        bookingsThisMonth: bookMap.get(f.id) ?? 0,
        adminEmail: adminMap.get(f.id) || null,
      }))
    } catch (err) {
      console.error('[master-admin] getCachedFacilityInfos failed:', err)
      return []
    }
  },
  ['master-admin-facility-infos'],
  { revalidate: 300, tags: ['facilities'] },
)

const getCachedPendingAccessRequests = unstable_cache(
  async () => {
    try {
      return await db.query.accessRequests.findMany({
        where: (t) => eq(t.status, 'pending'),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      })
    } catch (err) {
      console.error('[master-admin] getCachedPendingAccessRequests failed:', err)
      return []
    }
  },
  ['master-admin-pending-access-requests'],
  { revalidate: 60, tags: ['access-requests'] },
)

const getCachedActiveFacilitiesList = unstable_cache(
  async () => {
    try {
      return await db.query.facilities.findMany({
        where: (t) => eq(t.active, true),
        orderBy: (t, { asc }) => [asc(t.name)],
        columns: { id: true, name: true, facilityCode: true },
      })
    } catch (err) {
      console.error('[master-admin] getCachedActiveFacilitiesList failed:', err)
      return []
    }
  },
  ['master-admin-active-facilities-list'],
  { revalidate: 300, tags: ['facilities'] },
)

const getCachedFranchiseList = unstable_cache(
  async () => {
    try {
      return await db.query.franchises.findMany({
        with: {
          owner: { columns: { email: true, fullName: true } },
          franchiseFacilities: {
            with: { facility: { columns: { id: true, name: true } } },
          },
        },
        orderBy: (t, { asc }) => [asc(t.name)],
      })
    } catch (err) {
      console.error('[master-admin] getCachedFranchiseList failed:', err)
      return []
    }
  },
  ['master-admin-franchise-list'],
  { revalidate: 300, tags: ['facilities'] },
)

export default async function SuperAdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) {
    redirect('/dashboard')
  }

  const now = new Date()
  const yearMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const cookieStore = await cookies()
  const currentFacilityId = cookieStore.get('selected_facility_id')?.value ?? ''

  const [facilityInfos, pendingRequests, activeFacilitiesList, franchiseList] = await Promise.all([
    getCachedFacilityInfos(yearMonthKey),
    getCachedPendingAccessRequests(),
    getCachedActiveFacilitiesList(),
    getCachedFranchiseList(),
  ])

  return (
    <MasterAdminClient
      currentFacilityId={currentFacilityId}
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
