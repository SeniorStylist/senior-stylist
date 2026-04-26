import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, residents, bookings, stylistFacilityAssignments } from '@/db/schema'
import { eq, count } from 'drizzle-orm'
import { fuzzyScore } from '@/lib/fuzzy'

interface FacilityRow {
  id: string
  name: string
  facilityCode: string | null
  address: string | null
  phone: string | null
  contactEmail: string | null
  paymentType: string
  residents: number
  bookings: number
  stylists: number
}

interface Candidate {
  secondary: FacilityRow
  primary: FacilityRow
  score: number
  confidence: 'high' | 'medium' | 'low'
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.email !== process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const allActive = await db.query.facilities.findMany({
      where: eq(facilities.active, true),
      columns: {
        id: true,
        name: true,
        facilityCode: true,
        address: true,
        phone: true,
        contactEmail: true,
        paymentType: true,
      },
    })
    const fidFacilities = allActive.filter((f) => f.facilityCode)
    const noFidFacilities = allActive.filter((f) => !f.facilityCode)

    const rCounts = await db
      .select({ facilityId: residents.facilityId, c: count() })
      .from(residents)
      .where(eq(residents.active, true))
      .groupBy(residents.facilityId)
    const bCounts = await db
      .select({ facilityId: bookings.facilityId, c: count() })
      .from(bookings)
      .groupBy(bookings.facilityId)
    const sCounts = await db
      .select({ facilityId: stylistFacilityAssignments.facilityId, c: count() })
      .from(stylistFacilityAssignments)
      .where(eq(stylistFacilityAssignments.active, true))
      .groupBy(stylistFacilityAssignments.facilityId)

    const rMap = new Map(rCounts.map((r) => [r.facilityId, Number(r.c)]))
    const bMap = new Map(bCounts.map((r) => [r.facilityId, Number(r.c)]))
    const sMap = new Map(sCounts.map((r) => [r.facilityId, Number(r.c)]))

    const withCounts = (f: typeof allActive[number]): FacilityRow => ({
      id: f.id,
      name: f.name,
      facilityCode: f.facilityCode,
      address: f.address,
      phone: f.phone,
      contactEmail: f.contactEmail,
      paymentType: f.paymentType,
      residents: rMap.get(f.id) ?? 0,
      bookings: bMap.get(f.id) ?? 0,
      stylists: sMap.get(f.id) ?? 0,
    })

    const candidates: Candidate[] = []
    const unpaired: FacilityRow[] = []

    for (const nf of noFidFacilities) {
      let best: typeof fidFacilities[number] | null = null
      let bestScore = 0
      for (const f of fidFacilities) {
        const s = fuzzyScore(nf.name, f.name)
        if (s > bestScore) {
          bestScore = s
          best = f
        }
      }
      if (best && bestScore >= 0.6) {
        const confidence: 'high' | 'medium' | 'low' =
          bestScore >= 1.0 ? 'high' : bestScore >= 0.8 ? 'medium' : 'low'
        candidates.push({
          secondary: withCounts(nf),
          primary: withCounts(best),
          score: bestScore,
          confidence,
        })
      } else {
        unpaired.push(withCounts(nf))
      }
    }

    candidates.sort((a, b) => b.score - a.score)

    return Response.json({
      data: { candidates, unpaired, fidFacilityCount: fidFacilities.length },
    })
  } catch (err) {
    return Response.json(
      { error: (err as Error).message || 'Failed to load candidates' },
      { status: 500 },
    )
  }
}
