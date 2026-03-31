import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { residents, bookings } from '@/db/schema'
import { eq, and, ne } from 'drizzle-orm'

const WORD_EXPANSIONS: Record<string, string> = { w: 'wash', c: 'cut', hl: 'highlight', clr: 'color' }

function normalizeWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => WORD_EXPANSIONS[w] ?? w)
    .sort()
}

function fuzzyScore(a: string, b: string): number {
  const aw = normalizeWords(a)
  const bw = normalizeWords(b)
  if (!aw.length || !bw.length) return 0
  const intersection = aw.filter(w => bw.includes(w))
  return intersection.length / Math.max(aw.length, bw.length)
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isMasterAdmin = superAdminEmail && user.email === superAdminEmail
    if (!isMasterAdmin && facilityUser.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { facilityId } = facilityUser

    const [residentsList, bookingsList] = await Promise.all([
      db
        .select({ id: residents.id, name: residents.name, roomNumber: residents.roomNumber })
        .from(residents)
        .where(and(eq(residents.facilityId, facilityId), eq(residents.active, true))),
      db
        .select({ residentId: bookings.residentId, startTime: bookings.startTime })
        .from(bookings)
        .where(and(eq(bookings.facilityId, facilityId), ne(bookings.status, 'cancelled'))),
    ])

    // Aggregate stats per resident in JS
    const statsMap = new Map<string, { count: number; lastVisit: string | null }>()
    for (const b of bookingsList) {
      const visitTime =
        b.startTime instanceof Date ? b.startTime.toISOString() : String(b.startTime)
      const existing = statsMap.get(b.residentId)
      if (!existing) {
        statsMap.set(b.residentId, { count: 1, lastVisit: visitTime })
      } else {
        existing.count++
        // Keep most recent (bookings are not pre-sorted here so compare)
        if (!existing.lastVisit || visitTime > existing.lastVisit) {
          existing.lastVisit = visitTime
        }
      }
    }

    type ResidentForMerge = {
      id: string
      name: string
      roomNumber: string | null
      appointmentCount: number
      lastVisit: string | null
    }

    const enriched: ResidentForMerge[] = residentsList.map(r => ({
      id: r.id,
      name: r.name,
      roomNumber: r.roomNumber,
      appointmentCount: statsMap.get(r.id)?.count ?? 0,
      lastVisit: statsMap.get(r.id)?.lastVisit ?? null,
    }))

    // Compute all pairs with score >= 0.6
    const pairs: {
      a: ResidentForMerge
      b: ResidentForMerge
      score: number
      sameRoom: boolean
    }[] = []

    for (let i = 0; i < enriched.length; i++) {
      for (let j = i + 1; j < enriched.length; j++) {
        const score = fuzzyScore(enriched[i].name, enriched[j].name)
        if (score >= 0.6) {
          pairs.push({
            a: enriched[i],
            b: enriched[j],
            score,
            sameRoom: !!(
              enriched[i].roomNumber &&
              enriched[j].roomNumber &&
              enriched[i].roomNumber === enriched[j].roomNumber
            ),
          })
        }
      }
    }

    // Sort: same room first, then by score descending
    pairs.sort((a, b) => {
      if (a.sameRoom !== b.sameRoom) return a.sameRoom ? -1 : 1
      return b.score - a.score
    })

    return Response.json({ data: { pairs } })
  } catch (err) {
    console.error('GET /api/residents/duplicates error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
