import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, services } from '@/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'
import { matchService } from '@/lib/service-log-import'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  facilityId: z.string().uuid().optional(),
})

async function getSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) return null
  return user
}

export async function POST(request: Request) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }

    const whereConditions = parsed.data.facilityId
      ? and(
          eq(bookings.needsReview, true),
          eq(bookings.active, true),
          eq(bookings.facilityId, parsed.data.facilityId),
        )
      : and(eq(bookings.needsReview, true), eq(bookings.active, true))

    // Fetch all unresolved bookings (only columns needed)
    const unresolved = await db.query.bookings.findMany({
      where: whereConditions,
      columns: {
        id: true,
        facilityId: true,
        rawServiceName: true,
        priceCents: true,
      },
    })

    if (unresolved.length === 0) {
      return Response.json({ data: { matched: 0, stillUnresolved: 0 } })
    }

    // Fetch active services per unique facility (one query, not N)
    const facilityIds = Array.from(new Set(unresolved.map((b) => b.facilityId)))
    const allServices = await db.query.services.findMany({
      where: and(inArray(services.facilityId, facilityIds), eq(services.active, true)),
      columns: { id: true, facilityId: true, name: true, priceCents: true, pricingType: true, active: true },
    })
    const servicesByFacility = new Map<string, typeof allServices>()
    for (const s of allServices) {
      const arr = servicesByFacility.get(s.facilityId) ?? []
      arr.push(s)
      servicesByFacility.set(s.facilityId, arr)
    }

    // Run the matching cascade for each booking
    const toUpdate: Array<{ id: string; serviceId: string; serviceIds: string[] }> = []
    for (const booking of unresolved) {
      const candidates = servicesByFacility.get(booking.facilityId) ?? []
      if (candidates.length === 0) continue
      const result = matchService(
        booking.rawServiceName ?? '',
        booking.priceCents ?? 0,
        candidates,
      )
      if (!result.needsReview && result.serviceIds.length > 0) {
        toUpdate.push({
          id: booking.id,
          serviceId: result.serviceIds[0],
          serviceIds: result.serviceIds,
        })
      }
    }

    // Bulk-update matched bookings in chunks of 100 to avoid huge IN lists
    const CHUNK = 100
    const now = new Date()
    for (let i = 0; i < toUpdate.length; i += CHUNK) {
      const chunk = toUpdate.slice(i, i + CHUNK)
      // Update individually — Drizzle can't bulk-set different values per row in one query
      await Promise.all(
        chunk.map((row) =>
          db
            .update(bookings)
            .set({
              serviceId: row.serviceId,
              serviceIds: row.serviceIds,
              needsReview: false,
              updatedAt: now,
            })
            .where(eq(bookings.id, row.id)),
        ),
      )
    }

    revalidateTag('bookings', {})

    return Response.json({
      data: {
        matched: toUpdate.length,
        stillUnresolved: unresolved.length - toUpdate.length,
        resolvedIds: toUpdate.map((r) => r.id),
      },
    })
  } catch (err) {
    console.error('[import-review rematch] error:', err)
    return Response.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
