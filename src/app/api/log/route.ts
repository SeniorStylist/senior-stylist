import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { bookings, logEntries, facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { getEffectiveStylistId } from '@/lib/effective-stylist'
import { dayRangeInTimezone } from '@/lib/time'
import { eq, and, gte, lt } from 'drizzle-orm'
import { NextRequest, after } from 'next/server'
import { toClientJson } from '@/lib/sanitize'
import { isTutorialRequest } from '@/lib/help/tutorial-request'
import { logEntryCreateSchema } from '@/lib/validation/log-entry'

// P57 — `after()` charge work counts against this function's duration limit,
// so a finalize that charges several autopay residents (one Stripe round-trip
// each) needs more than the platform's 10s default. Without this a sweep is
// cut mid-charge; the remainder is idempotent and picked up by the next
// finalize or the nightly sweep, but the family waits a day for its receipt.
export const maxDuration = 60

// Phase 25 — schema lives in src/lib/validation/log-entry.ts so client
// payload builders can type against LogEntryInput (drift = tsc error).
const createSchema = logEntryCreateSchema

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    // P57 — matches the POST below: the legacy read-only role has no business
    // enumerating the day's log entries (their ids were the first half of the
    // viewer-triggers-a-charge path closed in PUT /api/log/[id]).
    if (facilityUser.role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 })
    const { facilityId } = facilityUser

    // P30 full lockdown — stylists read only their own section of the day
    const ownStylistId =
      facilityUser.role === 'stylist' ? await getEffectiveStylistId(user.id) : null

    const dateParam =
      request.nextUrl.searchParams.get('date') ??
      new Date().toISOString().split('T')[0]

    // P32 — the day window is the FACILITY's calendar day (was UTC, which put
    // an 8pm-ET booking on tomorrow's log for US facilities).
    const tzRow = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { timezone: true },
    })
    const dayRange = dayRangeInTimezone(dateParam, tzRow?.timezone ?? 'America/New_York')
    const dayStart = dayRange?.start ?? new Date(dateParam + 'T00:00:00.000Z')
    const dayEnd = dayRange?.end ?? new Date(dateParam + 'T23:59:59.999Z')

    // is_demo filter — Phase 13. During a scripted tour show ONLY demo records
    // (sandbox); normally show only real records.
    const demo = isTutorialRequest(request)
    const [dayBookings, dayLogEntries] = await Promise.all([
      db.query.bookings.findMany({
        where: and(
          eq(bookings.facilityId, facilityId),
          eq(bookings.active, true),
          ...(facilityUser.role === 'stylist'
            ? [eq(bookings.stylistId, ownStylistId ?? '00000000-0000-0000-0000-000000000000')]
            : []),
          eq(bookings.isDemo, demo),
          gte(bookings.startTime, dayStart),
          lt(bookings.startTime, dayEnd),
        ),
        with: { resident: true, stylist: true, service: true },
        orderBy: (t, { asc }) => [asc(t.startTime)],
      }),
      db.query.logEntries.findMany({
        where: and(
          eq(logEntries.facilityId, facilityId),
          eq(logEntries.isDemo, demo),
          eq(logEntries.date, dateParam),
          ...(facilityUser.role === 'stylist'
            ? [eq(logEntries.stylistId, ownStylistId ?? '00000000-0000-0000-0000-000000000000')]
            : []),
        ),
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
    if (facilityUser.role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 })
    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      const i = parsed.error.issues[0]
      return Response.json({ error: `Invalid data — ${i?.message ?? 'check your input'}` }, { status: 422 })
    }

    const { stylistId, date, notes, finalized } = parsed.data

    // Stylists may only finalize / write day notes on their OWN log entry
    if (facilityUser.role === 'stylist') {
      const ownStylistId = await getEffectiveStylistId(user.id)
      if (!ownStylistId || ownStylistId !== stylistId) {
        return Response.json({ error: 'You can only update your own day log.' }, { status: 403 })
      }
    }

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

      // P55 — finalize fires the COF sweep: charges autopay residents' completed
      // unpaid bookings for this stylist-day. Idempotent (paid stamp + unpaid
      // re-check + cooldown).
      // P57 — wrapped in after(): an unawaited promise started as the response is
      // returned can be killed by the serverless freeze, silently dropping a REAL
      // card charge (the June 2026 unawaited-invite-email bug class). after() keeps
      // the invocation alive until it settles. Errors stay swallowed — a failed
      // sweep must never fail the finalize.
      if (finalized && !existing.finalized && !existing.isDemo) {
        after(async () => {
          try {
            const { autoCollectOnFinalize } = await import('@/lib/payments/triggers')
            await autoCollectOnFinalize(facilityId, stylistId, date)
          } catch (err) {
            console.error('[log POST] finalize sweep failed:', err)
          }
        })
      }

      return Response.json({ data: updated })
    }

    const entryIsDemo = isTutorialRequest(request)
    const [created] = await db
      .insert(logEntries)
      .values({
        facilityId,
        stylistId,
        date,
        notes: notes ?? null,
        finalized: finalized ?? false,
        finalizedAt: finalized ? new Date() : null,
        isDemo: entryIsDemo, // Phase 13 — tutorial-created log entry
      })
      .returning()

    // P55 — finalize-on-create fires the COF sweep too. P57 — after() for the
    // same reason as above: the money path must survive the response freeze.
    if (finalized && !entryIsDemo) {
      after(async () => {
        try {
          const { autoCollectOnFinalize } = await import('@/lib/payments/triggers')
          await autoCollectOnFinalize(facilityId, stylistId, date)
        } catch (err) {
          console.error('[log POST] finalize sweep failed:', err)
        }
      })
    }

    return Response.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/log error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
