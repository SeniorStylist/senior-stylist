import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, bookings } from '@/db/schema'
import { eq, count } from 'drizzle-orm'
import { z } from 'zod'
import { fuzzyScore, normalizeWords } from '@/lib/fuzzy'

export const dynamic = 'force-dynamic'

async function getSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) return null
  return user
}

const bodySchema = z.object({
  groups: z
    .array(
      z.object({
        facilityCode: z.string().regex(/^F\d{2,5}$/),
        facilityName: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(500),
})

interface ExistingInfo {
  id: string
  name: string
  facilityCode: string | null
  bookings: number
}

// Next free F-code = (max F-number across ALL facilities, active or not) + 1.
// We never reuse a gap left by an inactive facility — if a community returns,
// its old code is still theirs and won't have been handed out to someone else.
export function nextFacilityCode(codes: (string | null)[]): string {
  let max = 0
  for (const c of codes) {
    const m = c?.match(/^F(\d+)$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `F${max + 1}`
}

type ResolutionStatus = 'new' | 'exact' | 'code_name_diff' | 'possible_duplicate'

interface FacilityResolution {
  facilityCode: string
  facilityName: string
  status: ResolutionStatus
  existing: ExistingInfo | null
  score: number | null
}

// Detect, for each parsed facility group, whether it maps cleanly to a new
// facility, an exact existing one, a same-code-different-name conflict, or a
// likely duplicate recorded under a different (or no) code.
export async function POST(request: Request) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }

    // Fetch ALL facilities (active + inactive) — a code collision against an
    // inactive facility still counts, and the next-code calc must skip every
    // number that's ever been assigned.
    const allFacilities = await db.query.facilities.findMany({
      columns: { id: true, name: true, facilityCode: true, active: true },
    })
    const activeFacilities = allFacilities.filter((f) => f.active)
    const nextAvailableCode = nextFacilityCode(allFacilities.map((f) => f.facilityCode))

    const bCounts = await db
      .select({ facilityId: bookings.facilityId, c: count() })
      .from(bookings)
      .where(eq(bookings.active, true))
      .groupBy(bookings.facilityId)
    const bMap = new Map(bCounts.map((r) => [r.facilityId, Number(r.c)]))

    // Code collisions matched against ALL facilities; name-duplicate suggestions
    // only against active ones (never suggest merging into a dead facility).
    const byCode = new Map<string, (typeof allFacilities)[number]>()
    for (const f of allFacilities) {
      if (f.facilityCode) byCode.set(f.facilityCode, f)
    }

    const toInfo = (f: (typeof allFacilities)[number]): ExistingInfo => ({
      id: f.id,
      name: f.name,
      facilityCode: f.facilityCode,
      bookings: bMap.get(f.id) ?? 0,
    })

    const resolutions: FacilityResolution[] = parsed.data.groups.map((g) => {
      const normName = normalizeWords(g.facilityName).join(' ')

      // 1. Exact code match.
      const codeHit = byCode.get(g.facilityCode)
      if (codeHit) {
        const sameNames = normalizeWords(codeHit.name).join(' ') === normName
        return {
          facilityCode: g.facilityCode,
          facilityName: g.facilityName,
          status: sameNames ? 'exact' : 'code_name_diff',
          existing: toInfo(codeHit),
          score: null,
        }
      }

      // 2. No code match — look for a likely duplicate by name (active only).
      let best: (typeof activeFacilities)[number] | null = null
      let bestScore = 0
      for (const f of activeFacilities) {
        if (f.facilityCode === g.facilityCode) continue
        const s = fuzzyScore(g.facilityName, f.name)
        if (s > bestScore) {
          bestScore = s
          best = f
        }
      }
      if (best && bestScore >= 0.8) {
        return {
          facilityCode: g.facilityCode,
          facilityName: g.facilityName,
          status: 'possible_duplicate',
          existing: toInfo(best),
          score: Math.round(bestScore * 100) / 100,
        }
      }

      // 3. Brand new.
      return {
        facilityCode: g.facilityCode,
        facilityName: g.facilityName,
        status: 'new',
        existing: null,
        score: null,
      }
    })

    return Response.json({ data: { resolutions, nextAvailableCode } })
  } catch (err) {
    console.error('[resolve-facilities] error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
