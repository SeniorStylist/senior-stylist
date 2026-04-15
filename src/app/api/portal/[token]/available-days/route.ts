import { db } from '@/db'
import {
  residents,
  stylists,
  stylistAvailability,
  stylistFacilityAssignments,
  coverageRequests,
} from '@/db/schema'
import { and, eq, inArray, lte, gte } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const rl = await checkRateLimit('portalBook', token)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month')
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: 'Invalid month (YYYY-MM)' }, { status: 400 })
    }

    const resident = await db.query.residents.findFirst({
      where: eq(residents.portalToken, token),
      columns: { id: true, facilityId: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    const [yearStr, monthStr] = month.split('-')
    const year = Number(yearStr)
    const mo = Number(monthStr)
    const daysInMonth = new Date(Date.UTC(year, mo, 0)).getUTCDate()
    const monthStart = `${month}-01`
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, '0')}`

    const facStylists = await db
      .select({ id: stylists.id })
      .from(stylists)
      .innerJoin(
        stylistFacilityAssignments,
        and(
          eq(stylistFacilityAssignments.stylistId, stylists.id),
          eq(stylistFacilityAssignments.facilityId, resident.facilityId),
          eq(stylistFacilityAssignments.active, true),
        ),
      )
      .where(and(eq(stylists.active, true), eq(stylists.status, 'active')))

    if (!facStylists.length) {
      return Response.json({ data: { availableDates: [] } })
    }
    const stylistIds = facStylists.map((s) => s.id)

    const avail = await db
      .select({
        stylistId: stylistAvailability.stylistId,
        dayOfWeek: stylistAvailability.dayOfWeek,
      })
      .from(stylistAvailability)
      .where(
        and(
          inArray(stylistAvailability.stylistId, stylistIds),
          eq(stylistAvailability.facilityId, resident.facilityId),
          eq(stylistAvailability.active, true),
        ),
      )
    // dow → set of stylistIds
    const dowMap = new Map<number, Set<string>>()
    for (const row of avail) {
      if (!dowMap.has(row.dayOfWeek)) dowMap.set(row.dayOfWeek, new Set())
      dowMap.get(row.dayOfWeek)!.add(row.stylistId)
    }

    const cover = await db
      .select({
        stylistId: coverageRequests.stylistId,
        substituteStylistId: coverageRequests.substituteStylistId,
        startDate: coverageRequests.startDate,
        endDate: coverageRequests.endDate,
      })
      .from(coverageRequests)
      .where(
        and(
          eq(coverageRequests.facilityId, resident.facilityId),
          inArray(coverageRequests.status, ['open', 'filled']),
          lte(coverageRequests.startDate, monthEnd),
          gte(coverageRequests.endDate, monthStart),
        ),
      )

    const availableDates: string[] = []
    const today = new Date()
    const todayStr = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`
      if (iso < todayStr) continue
      const date = new Date(Date.UTC(year, mo - 1, d))
      const dow = date.getUTCDay()
      const candidates = dowMap.get(dow)
      if (!candidates || candidates.size === 0) continue

      // Apply coverage shadowing on this date
      const effective = new Set(candidates)
      for (const c of cover) {
        if (c.startDate <= iso && c.endDate >= iso) {
          effective.delete(c.stylistId)
          if (c.substituteStylistId && candidates.has(c.substituteStylistId)) {
            effective.add(c.substituteStylistId)
          }
        }
      }
      if (effective.size > 0) availableDates.push(iso)
    }

    return Response.json({ data: { availableDates } })
  } catch (err) {
    console.error('GET /api/portal/[token]/available-days error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
