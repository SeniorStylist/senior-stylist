import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  coverageRequests,
  stylistAvailability,
  stylists,
  stylistFacilityAssignments,
  facilities,
} from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { and, eq, lte, gte, inArray, isNull } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { extractZip, getZipsWithinMiles } from '@/lib/zip-coords'

function parseDateUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10))
  return new Date(Date.UTC(y, m - 1, d))
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    // P39 — master admin (env email, no facility row) may query any facility
    // via ?facilityId= (supervisor model).
    const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const master = !!su && user.email === su
    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master && !facilityUser) return Response.json({ error: 'No facility' }, { status: 403 })
    if (!master && facilityUser!.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    let scopeFacilityId: string
    if (master) {
      const facParam = request.nextUrl.searchParams.get('facilityId') ?? ''
      if (!/^[0-9a-f-]{36}$/i.test(facParam)) {
        return Response.json({ error: 'facilityId required' }, { status: 422 })
      }
      scopeFacilityId = facParam
    } else {
      scopeFacilityId = facilityUser!.facilityId
    }

    const date = request.nextUrl.searchParams.get('date') ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: 'Invalid date' }, { status: 400 })
    }
    const dayOfWeek = parseDateUTC(date).getUTCDay()

    // Fetch facility address for zip-proximity ranking
    const facilityRow = await db.query.facilities.findFirst({
      where: eq(facilities.id, scopeFacilityId),
      columns: { address: true },
    })
    const facilityZip = extractZip(facilityRow?.address ?? '')

    // Facility pool: stylists at this facility, active, with availability on this DoW,
    // not themselves on an open/filled coverage request covering this date.
    const facilityStylists = await db
      .select({
        id: stylists.id,
        name: stylists.name,
        stylistCode: stylists.stylistCode,
        address: stylists.address,
      })
      .from(stylists)
      .innerJoin(
        stylistFacilityAssignments,
        and(
          eq(stylistFacilityAssignments.stylistId, stylists.id),
          eq(stylistFacilityAssignments.facilityId, scopeFacilityId),
          eq(stylistFacilityAssignments.active, true),
        ),
      )
      .innerJoin(
        stylistAvailability,
        and(
          eq(stylistAvailability.stylistId, stylists.id),
          eq(stylistAvailability.facilityId, scopeFacilityId),
          eq(stylistAvailability.dayOfWeek, dayOfWeek),
          eq(stylistAvailability.active, true),
        ),
      )
      .where(and(eq(stylists.active, true), eq(stylists.status, 'active')))

    const facilityIds = facilityStylists.map((s) => s.id)
    const onCoverage = facilityIds.length
      ? await db
          .select({ stylistId: coverageRequests.stylistId })
          .from(coverageRequests)
          .where(
            and(
              inArray(coverageRequests.stylistId, facilityIds),
              inArray(coverageRequests.status, ['open', 'filled']),
              lte(coverageRequests.startDate, date),
              gte(coverageRequests.endDate, date),
            ),
          )
      : []
    const excluded = new Set(onCoverage.map((r) => r.stylistId))
    const dedup = new Map<string, { id: string; name: string; stylistCode: string; address: string | null }>()
    for (const s of facilityStylists) {
      if (excluded.has(s.id)) continue
      if (!dedup.has(s.id)) dedup.set(s.id, s)
    }

    // Franchise pool: active, facilityId IS NULL, franchiseId = caller's franchise.
    const franchise = await getUserFranchise(user.id)
    let franchisePool: Array<{ id: string; name: string; stylistCode: string; address: string | null }> = []
    if (franchise) {
      franchisePool = await db
        .select({
          id: stylists.id,
          name: stylists.name,
          stylistCode: stylists.stylistCode,
          address: stylists.address,
        })
        .from(stylists)
        .where(
          and(
            eq(stylists.franchiseId, franchise.franchiseId),
            isNull(stylists.facilityId),
            eq(stylists.active, true),
          ),
        )
    }

    // Build nearby zip set for proximity ranking (5-mile default radius)
    const nearbyZips = facilityZip ? new Set(getZipsWithinMiles(facilityZip, 5)) : null

    function withProximity<T extends { id: string; name: string; stylistCode: string; address: string | null }>(
      list: T[]
    ): Array<T & { nearby: boolean }> {
      return list.map((s) => {
        const stylistZip = extractZip(s.address ?? '')
        const nearby = !!(facilityZip && stylistZip && nearbyZips?.has(stylistZip))
        return { ...s, nearby }
      }).sort((a, b) => {
        if (a.nearby !== b.nearby) return a.nearby ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    }

    return Response.json({
      data: {
        facilityStylists: withProximity(Array.from(dedup.values())),
        franchiseStylists: withProximity(franchisePool),
      },
    })
  } catch (err) {
    console.error('[coverage/substitutes] error:', err)
    return Response.json({ error: 'Failed to load substitutes' }, { status: 500 })
  }
}
