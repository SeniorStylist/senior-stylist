import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, logEntries } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and, gte, lt } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { toClientJson } from '@/lib/sanitize'
import { isTutorialRequest } from '@/lib/help/tutorial-request'

const createSchema = z.object({
  stylistId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(2000).optional(),
  finalized: z.boolean().optional(),
})

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const dateParam =
      request.nextUrl.searchParams.get('date') ??
      new Date().toISOString().split('T')[0]

    // Query the full UTC day — good enough for single-timezone facilities
    const dayStart = new Date(dateParam + 'T00:00:00.000Z')
    const dayEnd = new Date(dateParam + 'T23:59:59.999Z')

    // is_demo filter — Phase 13. Relax during a scripted tour so the tour's demo
    // booking + log entry are visible.
    const includeDemo = isTutorialRequest(request)
    const bookingConds = [
      eq(bookings.facilityId, facilityId),
      eq(bookings.active, true),
      gte(bookings.startTime, dayStart),
      lt(bookings.startTime, dayEnd),
    ]
    if (!includeDemo) bookingConds.push(eq(bookings.isDemo, false))
    const logConds = [eq(logEntries.facilityId, facilityId), eq(logEntries.date, dateParam)]
    if (!includeDemo) logConds.push(eq(logEntries.isDemo, false))

    const [dayBookings, dayLogEntries] = await Promise.all([
      db.query.bookings.findMany({
        where: and(...bookingConds),
        with: { resident: true, stylist: true, service: true },
        orderBy: (t, { asc }) => [asc(t.startTime)],
      }),
      db.query.logEntries.findMany({
        where: and(...logConds),
      }),
    ])

    return Response.json({ data: { bookings: toClientJson(dayBookings), logEntries: dayLogEntries } })
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

    const facilityUser = await getUserFacility(user.id)
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
        isDemo: isTutorialRequest(request), // Phase 13 — tutorial-created log entry
      })
      .returning()

    return Response.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/log error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
