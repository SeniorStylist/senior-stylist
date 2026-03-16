import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, logEntries, facilityUsers } from '@/db/schema'
import { eq, and, gte, lt } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const createSchema = z.object({
  stylistId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
  finalized: z.boolean().optional(),
})

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await db.query.facilityUsers.findFirst({
      where: (t, { eq }) => eq(t.userId, user.id),
    })
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const dateParam =
      request.nextUrl.searchParams.get('date') ??
      new Date().toISOString().split('T')[0]

    // Query the full UTC day — good enough for single-timezone facilities
    const dayStart = new Date(dateParam + 'T00:00:00.000Z')
    const dayEnd = new Date(dateParam + 'T23:59:59.999Z')

    const [dayBookings, dayLogEntries] = await Promise.all([
      db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facilityId),
          gte(bookings.startTime, dayStart),
          lt(bookings.startTime, dayEnd)
        ),
        with: { resident: true, stylist: true, service: true },
        orderBy: (t, { asc }) => [asc(t.startTime)],
      }),
      db.query.logEntries.findMany({
        where: and(
          eq(logEntries.facilityId, facilityId),
          eq(logEntries.date, dateParam)
        ),
      }),
    ])

    return Response.json({ data: { bookings: dayBookings, logEntries: dayLogEntries } })
  } catch (err) {
    console.error('GET /api/log error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await db.query.facilityUsers.findFirst({
      where: (t, { eq }) => eq(t.userId, user.id),
    })
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { stylistId, date, notes, finalized } = parsed.data

    // Check if entry already exists
    const existing = await db.query.logEntries.findFirst({
      where: and(
        eq(logEntries.facilityId, facilityId),
        eq(logEntries.stylistId, stylistId),
        eq(logEntries.date, date)
      ),
    })

    if (existing) {
      // Finalized logs cannot be unfinalized
      if (existing.finalized && finalized === false) {
        return Response.json({ error: 'Cannot unfinalize a log entry' }, { status: 400 })
      }

      const [updated] = await db
        .update(logEntries)
        .set({
          notes: notes ?? existing.notes,
          finalized: finalized ?? existing.finalized,
          finalizedAt:
            finalized && !existing.finalized
              ? new Date()
              : existing.finalizedAt,
          updatedAt: new Date(),
        })
        .where(eq(logEntries.id, existing.id))
        .returning()

      return Response.json({ data: updated })
    }

    const [created] = await db
      .insert(logEntries)
      .values({
        facilityId,
        stylistId,
        date,
        notes: notes ?? null,
        finalized: finalized ?? false,
        finalizedAt: finalized ? new Date() : null,
      })
      .returning()

    return Response.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/log error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
