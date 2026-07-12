import { getAuthUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { cookies } from 'next/headers'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { and, eq, or, sql } from 'drizzle-orm'
import { MasterAdminClient } from './master-admin-client'

// Phase 22 — this page fires ~11 GROUP BY queries on a cold cache, all
// serialized through the single pooled DB connection (max:1). On a large org
// (100+ facilities) the cold render can exceed the default function limit and
// get killed → "A server error occurred". 60s gives it headroom; the four
// cached functions are instant once warm (5-min TTL).
export const maxDuration = 60
export const dynamic = 'force-dynamic'

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
  // Phase 16 G1 — composite 0-100 health score (null = not enough data)
  healthScore: number | null
}

const getCachedFacilityInfos = unstable_cache(
  // P27 — NO try/catch inside cached callbacks: unstable_cache would persist a
  // caught-and-returned [] for the whole revalidate window (one DB blip = 5 min
  // of "no facilities"). Errors propagate; the page-level catch renders empty
  // ONCE and the next request retries fresh.
  async (yearMonthKey: string, tutorialMode: boolean): Promise<FacilityInfo[]> => {
      const [year, month] = yearMonthKey.split('-').map((s) => Number(s))
      const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0)

      // 4 GROUP BY queries instead of 4 × N per-facility queries.
      // With max:1 connection, the per-facility loop serialized through one socket
      // (~120 queries for 30 facilities); this keeps it to 5 queries flat.
      // During a tutorial, show demo facilities alongside real ones so the just-created
      // practice facility appears in the list (cookie can't be read inside unstable_cache,
      // so tutorialMode is passed in and rides the cache key).
      const [allFacilities, residentRows, stylistRows, bookingRows, adminRows, cancelledRows, invoicedRows, collectedRows] = await Promise.all([
        db.query.facilities.findMany({
          // Tutorial mode is ADDITIVE: real active facilities PLUS demo/practice
          // ones (P27 — the old demo-ONLY branch let a leftover ss_tutorial_mode
          // cookie blank the entire grid for a 100+-facility org).
          where: tutorialMode
            ? or(and(eq(facilities.active, true), eq(facilities.isDemo, false)), eq(facilities.isDemo, true))
            : and(eq(facilities.active, true), eq(facilities.isDemo, false)),
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
        // Phase 16 G1 — health-score inputs (3 more batched GROUP BYs)
        db.execute(sql`
          SELECT facility_id::text AS fid, COUNT(*)::int AS c
          FROM bookings
          WHERE start_time >= ${monthStart.toISOString()} AND active = true AND status = 'cancelled'
          GROUP BY facility_id
        `),
        db.execute(sql`
          SELECT facility_id::text AS fid, COALESCE(SUM(amount_cents), 0)::bigint AS c
          FROM qb_invoices
          WHERE is_demo = false AND invoice_date >= CURRENT_DATE - 90
          GROUP BY facility_id
        `),
        db.execute(sql`
          SELECT facility_id::text AS fid, COALESCE(SUM(amount_cents), 0)::bigint AS c
          FROM qb_payments
          WHERE is_demo = false AND payment_date >= (CURRENT_DATE - 90)::text
          GROUP BY facility_id
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
      const cancelMap = numMap(cancelledRows as unknown[])
      const invoicedMap = numMap(invoicedRows as unknown[])
      const collectedMap = numMap(collectedRows as unknown[])

      // Phase 16 G1 — 0-100 health score: utilization 40 (bookings per resident vs a
      // 0.6/month target), collection 40 (collected/invoiced last 90 days, clamped),
      // cancellations 20 (1 − cancel rate this month). null when too little data.
      const healthFor = (facilityId: string, residentCount: number, bookingsThisMonth: number): number | null => {
        const invoiced = invoicedMap.get(facilityId) ?? 0
        if (residentCount < 5 && invoiced === 0) return null
        const utilization = residentCount > 0 ? Math.min(bookingsThisMonth / residentCount / 0.6, 1) : 0
        const collected = collectedMap.get(facilityId) ?? 0
        const collection = invoiced > 0 ? Math.min(collected / invoiced, 1) : 0.5 // neutral when nothing invoiced
        const cancelled = cancelMap.get(facilityId) ?? 0
        const totalThisMonth = bookingsThisMonth + cancelled
        const cancelScore = totalThisMonth > 0 ? 1 - cancelled / totalThisMonth : 1
        return Math.round(utilization * 40 + collection * 40 + cancelScore * 20)
      }

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
        healthScore: healthFor(f.id, resMap.get(f.id) ?? 0, bookMap.get(f.id) ?? 0),
      }))
  },
  ['master-admin-facility-infos'],
  { revalidate: 300, tags: ['facilities'] },
)

const getCachedPendingAccessRequests = unstable_cache(
  async () => {
      const rows = await db.query.accessRequests.findMany({
        where: (t) => eq(t.status, 'pending'),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      })
      // Serialize INSIDE the cached callback — unstable_cache JSON round-trips
      // its results, so on a warm hit Date fields come back as STRINGS. Calling
      // .toISOString() on the cached value outside this function crashed the
      // whole page whenever an access request was pending (2026-07-12 outage).
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.fullName,
        role: r.role,
        status: r.status,
        userId: r.userId,
        createdAt: r.createdAt?.toISOString() ?? null,
      }))
  },
  ['master-admin-pending-access-requests'],
  { revalidate: 60, tags: ['access-requests'] },
)

const getCachedActiveFacilitiesList = unstable_cache(
  async () => {
      return await db.query.facilities.findMany({
        where: (t) => and(eq(t.active, true), eq(t.isDemo, false)),
        orderBy: (t, { asc }) => [asc(t.name)],
        columns: { id: true, name: true, facilityCode: true },
      })
  },
  ['master-admin-active-facilities-list'],
  { revalidate: 300, tags: ['facilities'] },
)

const getCachedFranchiseList = unstable_cache(
  async () => {
      return await db.query.franchises.findMany({
        with: {
          owner: { columns: { email: true, fullName: true } },
          franchiseFacilities: {
            with: { facility: { columns: { id: true, name: true } } },
          },
        },
        orderBy: (t, { asc }) => [asc(t.name)],
      })
  },
  ['master-admin-franchise-list'],
  { revalidate: 300, tags: ['facilities'] },
)

export default async function SuperAdminPage() {
  const user = await getAuthUser()
  if (!user) redirect('/login')

  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) {
    redirect('/dashboard')
  }

  const now = new Date()
  const yearMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const cookieStore = await cookies()
  const currentFacilityId = cookieStore.get('selected_facility_id')?.value ?? ''
  const tutorialMode = cookieStore.get('ss_tutorial_mode')?.value === '1'

  // Phase 22 — SEQUENTIAL on cold cache so the four functions' query bursts
  // don't overlap on the max:1 connection (peak concurrency = one function's
  // queries, not all four). Warm cache makes each an instant no-DB return.
  // P27 — failures are caught HERE (outside the cache) so an error is never
  // persisted as an empty list; the next request retries fresh.
  const logFail = (name: string) => (err: unknown) => {
    console.error(`[master-admin] ${name} failed:`, err)
    return []
  }
  const facilityInfos = await getCachedFacilityInfos(yearMonthKey, tutorialMode).catch(logFail('getCachedFacilityInfos'))
  const pendingRequests = await getCachedPendingAccessRequests().catch(logFail('getCachedPendingAccessRequests'))
  const activeFacilitiesList = await getCachedActiveFacilitiesList().catch(logFail('getCachedActiveFacilitiesList'))
  const franchiseList = await getCachedFranchiseList().catch(logFail('getCachedFranchiseList'))

  return (
    <MasterAdminClient
      currentFacilityId={currentFacilityId}
      facilities={facilityInfos}
      tutorialMode={tutorialMode}
      pendingRequests={pendingRequests}
      activeFacilities={activeFacilitiesList}
      franchises={franchiseList.map((f) => ({
        id: f.id,
        name: f.name,
        ownerEmail: f.owner?.email ?? null,
        ownerName: f.owner?.fullName ?? null,
        // Drizzle types the facility relation non-null, but an orphaned join
        // row would make it null at runtime — filter instead of throwing.
        facilities: f.franchiseFacilities
          .filter((ff) => ff.facility != null)
          .map((ff) => ({
            id: ff.facility.id,
            name: ff.facility.name,
          })),
      }))}
    />
  )
}
