import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { logEntries } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { getEffectiveStylistId } from '@/lib/effective-stylist'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest, after } from 'next/server'

// P57 — `after()` charge work counts against this function's duration limit,
// so a finalize that charges several autopay residents (one Stripe round-trip
// each) needs more than the platform's 10s default. Without this a sweep is
// cut mid-charge; the remainder is idempotent and picked up by the next
// finalize or the nightly sweep, but the family waits a day for its receipt.
export const maxDuration = 60

const updateSchema = z.object({
  notes: z.string().max(2000).optional(),
  finalized: z.boolean().optional(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    // P57 — the sibling POST /api/log has blocked `viewer` since the 2026-06-15
    // authorization audit; this route never did. Finalizing is what fires
    // autoCollectOnFinalize, and now that the trigger runs inside after() it is
    // guaranteed to complete — so without this guard a legacy read-only login
    // could reliably charge every autopay resident's saved card at an
    // on_completion facility.
    if (facilityUser.role === 'viewer') return Response.json({ error: 'Forbidden' }, { status: 403 })
    const { facilityId } = facilityUser

    const existing = await db.query.logEntries.findFirst({
      where: and(eq(logEntries.id, id), eq(logEntries.facilityId, facilityId)),
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    // Stylists may only update their OWN log entry
    if (facilityUser.role === 'stylist') {
      const ownStylistId = await getEffectiveStylistId(user.id)
      if (!ownStylistId || ownStylistId !== existing.stylistId) {
        return Response.json({ error: 'You can only update your own day log.' }, { status: 403 })
      }
    }

    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      const i = parsed.error.issues[0]
      return Response.json({ error: `Invalid data — ${i?.message ?? 'check your input'}` }, { status: 422 })
    }

    const [updated] = await db
      .update(logEntries)
      .set({
        notes: parsed.data.notes ?? existing.notes,
        finalized: parsed.data.finalized ?? existing.finalized,
        finalizedAt:
          parsed.data.finalized === false
            ? null
            : parsed.data.finalized && !existing.finalized
            ? new Date()
            : existing.finalizedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(logEntries.id, id), eq(logEntries.facilityId, facilityId)))
      .returning()

    // P55 — finalize fires the COF sweep: charges autopay residents' completed
    // unpaid bookings for this stylist-day. Idempotent (paid stamp + unpaid
    // re-check + cooldown), so re-finalize after an edit never double-charges.
    // P57 — after() (not a bare unawaited promise): the serverless freeze at
    // response time can kill an in-flight charge, silently dropping real money.
    // Errors stay swallowed so a failed sweep never fails the finalize.
    if (parsed.data.finalized === true && !existing.finalized && !existing.isDemo) {
      after(async () => {
        try {
          const { autoCollectOnFinalize } = await import('@/lib/payments/triggers')
          await autoCollectOnFinalize(facilityId, existing.stylistId, existing.date)
        } catch (err) {
          console.error('[log PUT] finalize sweep failed:', err)
        }
      })
    }

    return Response.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/log/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
