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

function looksLikeTruncation(a: string, b: string): boolean {
  const aParts = a.trim().split(/\s+/)
  const bParts = b.trim().split(/\s+/)
  if (aParts.length < 2 || bParts.length < 2) return false
  const aFirst = aParts[0].toLowerCase()
  const bFirst = bParts[0].toLowerCase()
  if (aFirst !== bFirst) return false
  const aLast = aParts[aParts.length - 1].toLowerCase()
  const bLast = bParts[bParts.length - 1].toLowerCase()
  return aLast.startsWith(bLast) || bLast.startsWith(aLast)
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}

function looksLikeMisspelling(a: string, b: string): boolean {
  const aParts = a.trim().split(/\s+/)
  const bParts = b.trim().split(/\s+/)
  if (aParts.length === 1 && bParts.length === 1) {
    return levenshtein(aParts[0].toLowerCase(), bParts[0].toLowerCase()) <= 2
  }
  if (aParts.length >= 2 && bParts.length >= 2) {
    const firstDist = levenshtein(aParts[0].toLowerCase(), bParts[0].toLowerCase())
    const aLast = aParts[aParts.length - 1].toLowerCase()
    const bLast = bParts[bParts.length - 1].toLowerCase()
    return firstDist <= 2 && aLast[0] === bLast[0]
  }
  return false
}

function isDuplicate(a: string, b: string, score: number): boolean {
  return score >= 0.4 || looksLikeTruncation(a, b) || looksLikeMisspelling(a, b)
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

    // Compute all pairs — flag if fuzzyScore >= 0.4 OR truncation OR misspelling heuristics match
    const pairs: {
      a: ResidentForMerge
      b: ResidentForMerge
      score: number
      sameRoom: boolean
    }[] = []

    for (let i = 0; i < enriched.length; i++) {
      for (let j = i + 1; j < enriched.length; j++) {
        const score = fuzzyScore(enriched[i].name, enriched[j].name)
        if (isDuplicate(enriched[i].name, enriched[j].name, score)) {
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
