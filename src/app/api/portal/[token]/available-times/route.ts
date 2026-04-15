import { db } from '@/db'
import {
  residents,
  stylists,
  stylistAvailability,
  stylistFacilityAssignments,
} from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { resolveAvailableStylists } from '@/lib/portal-assignment'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

const SLOT_MINUTES = 30

function hhmmFromMinutes(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function minutesFromHM(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const rl = await checkRateLimit('portalBook', token)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const durationParam = Number(searchParams.get('duration') ?? '30')
    const duration = Number.isFinite(durationParam) && durationParam > 0 ? durationParam : 30

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return Response.json({ error: 'Invalid date' }, { status: 400 })
    }

    const resident = await db.query.residents.findFirst({
      where: eq(residents.portalToken, token),
      columns: { id: true, facilityId: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    const [y, mo, d] = date.split('-').map(Number)
    const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()

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
      return Response.json({ data: { availableSlots: [], bookedSlots: [] } })
    }
    const stylistIds = facStylists.map((s) => s.id)

    const avail = await db
      .select({
        startTime: stylistAvailability.startTime,
        endTime: stylistAvailability.endTime,
      })
      .from(stylistAvailability)
      .where(
        and(
          inArray(stylistAvailability.stylistId, stylistIds),
          eq(stylistAvailability.facilityId, resident.facilityId),
          eq(stylistAvailability.dayOfWeek, dow),
          eq(stylistAvailability.active, true),
        ),
      )

    if (!avail.length) {
      return Response.json({ data: { availableSlots: [], bookedSlots: [] } })
    }

    // Build candidate slots: every 30-min step within the union of availability windows
    const slotSet = new Set<number>()
    for (const a of avail) {
      const startMin = minutesFromHM(a.startTime)
      const endMin = minutesFromHM(a.endTime)
      for (let m = startMin; m + duration <= endMin; m += SLOT_MINUTES) {
        slotSet.add(m)
      }
    }
    const candidateMinutes = Array.from(slotSet).sort((a, b) => a - b)

    const availableSlots: string[] = []
    const bookedSlots: string[] = []

    for (const m of candidateMinutes) {
      const startDate = new Date(Date.UTC(y, mo - 1, d, Math.floor(m / 60), m % 60, 0))
      const endDate = new Date(startDate.getTime() + duration * 60 * 1000)
      const candidates = await resolveAvailableStylists({
        facilityId: resident.facilityId,
        startTime: startDate,
        endTime: endDate,
      })
      const hm = hhmmFromMinutes(m)
      if (candidates.length > 0) availableSlots.push(hm)
      else bookedSlots.push(hm)
    }

    return Response.json({ data: { availableSlots, bookedSlots } })
  } catch (err) {
    console.error('GET /api/portal/[token]/available-times error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
