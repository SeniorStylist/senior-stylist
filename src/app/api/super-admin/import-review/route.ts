import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, services } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { fuzzyScore } from '@/lib/fuzzy'

export const dynamic = 'force-dynamic'

async function getSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) return null
  return user
}

export async function GET() {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const reviewBookings = await db.query.bookings.findMany({
      where: and(eq(bookings.needsReview, true), eq(bookings.active, true)),
      with: {
        resident: { columns: { name: true, roomNumber: true } },
        facility: { columns: { name: true } },
        importBatch: { columns: { fileName: true, createdAt: true } },
      },
      orderBy: (t, { asc }) => [asc(t.startTime)],
    })

    if (reviewBookings.length === 0) {
      return Response.json({ data: { bookings: [], totalCount: 0 } })
    }

    // Pre-fetch services per facility (one query per unique facility, not per booking)
    const facilityIds = Array.from(new Set(reviewBookings.map((b) => b.facilityId)))
    const allServices = await db.query.services.findMany({
      where: and(inArray(services.facilityId, facilityIds), eq(services.active, true)),
      columns: { id: true, facilityId: true, name: true, priceCents: true, pricingType: true },
    })
    const servicesByFacility = new Map<string, typeof allServices>()
    for (const s of allServices) {
      if (s.pricingType === 'addon') continue
      const arr = servicesByFacility.get(s.facilityId) ?? []
      arr.push(s)
      servicesByFacility.set(s.facilityId, arr)
    }

    const enriched = reviewBookings.map((b) => {
      const candidates = servicesByFacility.get(b.facilityId) ?? []
      const raw = b.rawServiceName ?? ''
      const suggestions = raw
        ? candidates
            .map((s) => ({
              id: s.id,
              name: s.name,
              priceCents: s.priceCents,
              score: fuzzyScore(s.name, raw),
            }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
        : []

      return {
        id: b.id,
        rawServiceName: b.rawServiceName,
        priceCents: b.priceCents,
        startTime: b.startTime instanceof Date ? b.startTime.toISOString() : String(b.startTime),
        facilityId: b.facilityId,
        resident: b.resident,
        facility: b.facility,
        importBatch: b.importBatch
          ? {
              fileName: b.importBatch.fileName,
              createdAt:
                b.importBatch.createdAt instanceof Date
                  ? b.importBatch.createdAt.toISOString()
                  : b.importBatch.createdAt
                    ? String(b.importBatch.createdAt)
                    : null,
            }
          : null,
        suggestions,
      }
    })

    // Sort: most-recent batch first, then by startTime
    enriched.sort((a, b) => {
      const aT = a.importBatch?.createdAt ?? ''
      const bT = b.importBatch?.createdAt ?? ''
      if (aT !== bT) return bT.localeCompare(aT)
      return a.startTime.localeCompare(b.startTime)
    })

    // Include the full per-facility service list so the linker UI doesn't need
    // a separate master-admin-only services endpoint.
    const facilityServices: Record<string, { id: string; name: string; priceCents: number }[]> = {}
    for (const [facilityId, list] of servicesByFacility) {
      facilityServices[facilityId] = list
        .map((s) => ({ id: s.id, name: s.name, priceCents: s.priceCents }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }

    return Response.json({
      data: { bookings: enriched, totalCount: enriched.length, facilityServices },
    })
  } catch (err) {
    console.error('[import-review GET] error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
