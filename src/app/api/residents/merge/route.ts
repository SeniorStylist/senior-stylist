import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { residents, bookings } from '@/db/schema'
import { eq, and, count } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { z } from 'zod'

const mergeSchema = z.object({
  keepId: z.string().uuid(),
  mergeId: z.string().uuid(),
  finalName: z.string().min(1),
  finalRoom: z.string().nullable(),
})

export async function POST(request: Request) {
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

    const body = await request.json()
    const parsed = mergeSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { keepId, mergeId, finalName, finalRoom } = parsed.data

    if (keepId === mergeId) {
      return Response.json({ error: 'keepId and mergeId must be different' }, { status: 422 })
    }

    let bookingsMoved = 0

    await db.transaction(async (tx) => {
      // Security: verify both residents belong to this facility
      const [keepRes, mergeRes] = await Promise.all([
        tx
          .select({ id: residents.id })
          .from(residents)
          .where(and(eq(residents.id, keepId), eq(residents.facilityId, facilityId), eq(residents.active, true))),
        tx
          .select({ id: residents.id })
          .from(residents)
          .where(and(eq(residents.id, mergeId), eq(residents.facilityId, facilityId), eq(residents.active, true))),
      ])

      if (!keepRes.length) throw new Error('keepId resident not found in facility')
      if (!mergeRes.length) throw new Error('mergeId resident not found in facility')

      // Count bookings to move
      const [{ bookingCount }] = await tx
        .select({ bookingCount: count() })
        .from(bookings)
        .where(and(eq(bookings.residentId, mergeId), eq(bookings.facilityId, facilityId)))
      bookingsMoved = bookingCount

      // Move all bookings from mergeId → keepId
      if (bookingsMoved > 0) {
        await tx
          .update(bookings)
          .set({ residentId: keepId })
          .where(and(eq(bookings.residentId, mergeId), eq(bookings.facilityId, facilityId)))
      }

      // Deactivate + rename merged resident to free up the name for the unique constraint
      await tx
        .update(residents)
        .set({ active: false, name: sql`${residents.name} || '-merged'` })
        .where(and(eq(residents.id, mergeId), eq(residents.facilityId, facilityId)))

      // Update kept resident with final name and room
      await tx
        .update(residents)
        .set({ name: finalName, roomNumber: finalRoom })
        .where(and(eq(residents.id, keepId), eq(residents.facilityId, facilityId)))
    })

    return Response.json({ data: { bookingsMoved } })
  } catch (err) {
    console.error('POST /api/residents/merge error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
