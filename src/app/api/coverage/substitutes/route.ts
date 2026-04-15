import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import {
  coverageRequests,
  stylistAvailability,
  stylists,
  stylistFacilityAssignments,
} from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { and, eq, lte, gte, inArray, isNull } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

function parseDateUTC(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map((n) => parseInt(n, 10))
  return new Date(Date.UTC(y, m - 1, d))
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 403 })
    if (facilityUser.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const date = request.nextUrl.searchParams.get('date') ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: 'Invalid date' }, { status: 400 })
    }
    const dayOfWeek = parseDateUTC(date).getUTCDay()

    // Facility pool: stylists at this facility, active, with availability on this DoW,
    // not themselves on an open/filled coverage request covering this date.
    const facilityStylists = await db
      .select({
        id: stylists.id,
        name: stylists.name,
        stylistCode: stylists.stylistCode,
      })
      .from(stylists)
      .innerJoin(
        stylistFacilityAssignments,
        and(
          eq(stylistFacilityAssignments.stylistId, stylists.id),
          eq(stylistFacilityAssignments.facilityId, facilityUser.facilityId),
          eq(stylistFacilityAssignments.active, true),
        ),
      )
      .innerJoin(
        stylistAvailability,
        and(
          eq(stylistAvailability.stylistId, stylists.id),
          eq(stylistAvailability.facilityId, facilityUser.facilityId),
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
    const dedup = new Map<string, { id: string; name: string; stylistCode: string }>()
    for (const s of facilityStylists) {
      if (excluded.has(s.id)) continue
      if (!dedup.has(s.id)) dedup.set(s.id, s)
    }

    // Franchise pool: active, facilityId IS NULL, franchiseId = caller's franchise.
    const franchise = await getUserFranchise(user.id)
    let franchisePool: Array<{ id: string; name: string; stylistCode: string }> = []
    if (franchise) {
      franchisePool = await db
        .select({
          id: stylists.id,
          name: stylists.name,
          stylistCode: stylists.stylistCode,
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

    return Response.json({
      data: {
        facilityStylists: Array.from(dedup.values()).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
        franchiseStylists: franchisePool.sort((a, b) => a.name.localeCompare(b.name)),
      },
    })
  } catch (err) {
    console.error('[coverage/substitutes] error:', err)
    return Response.json({ error: 'Failed to load substitutes' }, { status: 500 })
  }
}
