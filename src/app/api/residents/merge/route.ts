import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { residents, bookings } from '@/db/schema'
import { eq, and, count } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'

const mergeSchema = z.object({
  keepId: z.string().uuid(),
  mergeId: z.string().uuid(),
  finalName: z.string().min(1).max(200),
  finalRoom: z.string().max(50).nullable(),
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
    // Bookkeepers may merge duplicate residents (they create them via OCR
    // log-sheet scanning); all other resident mutations stay admin-only.
    const canMerge = facilityUser.role === 'admin' || facilityUser.role === 'bookkeeper'
    if (!isMasterAdmin && !canMerge) {
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

    // P34 — verify both residents BEFORE the transaction so a stale pair
    // (a resident already merged away in a previous step / another tab)
    // returns a clean machine-readable 409 instead of a generic 500. The
    // client uses code 'stale_pair' to drop the card and resync the list.
    const [keepCheck, mergeCheck] = await Promise.all([
      db
        .select({ id: residents.id })
        .from(residents)
        .where(and(eq(residents.id, keepId), eq(residents.facilityId, facilityId), eq(residents.active, true))),
      db
        .select({ id: residents.id })
        .from(residents)
        .where(and(eq(residents.id, mergeId), eq(residents.facilityId, facilityId), eq(residents.active, true))),
    ])
    if (!keepCheck.length || !mergeCheck.length) {
      return Response.json(
        {
          error: 'This pair is out of date — one of these residents was already merged.',
          code: 'stale_pair',
        },
        { status: 409 },
      )
    }

    let bookingsMoved = 0

    await db.transaction(async (tx) => {
      // Re-verify inside the transaction (guards a race between the pre-check
      // and the tx — throwing here rolls back and surfaces as 500, which is
      // acceptable for the true concurrent-write edge).
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

    // The merge moves bookings between residents — bust cached booking reports.
    revalidateTag('bookings', {})

    return Response.json({ data: { bookingsMoved } })
  } catch (err) {
    console.error('POST /api/residents/merge error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
