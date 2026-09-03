// P60 — facility-side staffing. Until now the ONLY way to attach an EXISTING
// stylist to a facility was a <select> buried on the stylist's own detail
// page, one stylist at a time — staffing a new facility with five known
// stylists meant five detail-page trips, and the /stylists "+ Add stylist"
// affordance could only CREATE (which is how duplicate ST-codes got minted).
//
// POST assigns many existing stylists at once and can seed their weekly
// availability HERE — the thing that drives request auto-assignment and the
// working-day pickers — so a new facility is requestable on day one.
// GET returns the current active roster (the wizard's Done checklist reads it).

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { revalidateTag } from 'next/cache'
import { db } from '@/db'
import { facilities, stylistAvailability, stylistFacilityAssignments, stylists } from '@/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { resolveFacilityWrite } from '@/lib/facility-access'
import { getUserFranchise } from '@/lib/get-facility-id'

const bodySchema = z.object({
  assignments: z
    .array(
      z.object({
        stylistId: z.string().uuid(),
        /** Weekly availability at THIS facility (0=Sun … 6=Sat). Omit = leave as-is. */
        days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
        commissionPercent: z.number().int().min(0).max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
  /** Availability window for seeded days; defaults to the facility's working hours. */
  hours: z.object({ startTime: z.string().regex(/^\d{2}:\d{2}$/), endTime: z.string().regex(/^\d{2}:\d{2}$/) }).optional(),
})

export async function GET(_request: NextRequest, { params }: { params: Promise<{ facilityId: string }> }) {
  try {
    const { facilityId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const access = await resolveFacilityWrite(user, facilityId)
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status })

    const rows = await db
      .select({
        id: stylists.id,
        name: stylists.name,
        stylistCode: stylists.stylistCode,
        color: stylists.color,
        commissionPercent: stylistFacilityAssignments.commissionPercent,
      })
      .from(stylistFacilityAssignments)
      .innerJoin(stylists, eq(stylists.id, stylistFacilityAssignments.stylistId))
      .where(
        and(
          eq(stylistFacilityAssignments.facilityId, facilityId),
          eq(stylistFacilityAssignments.active, true),
          eq(stylists.active, true),
          eq(stylists.isDemo, false), // is_demo filter — Phase 13
        ),
      )
      .orderBy(stylists.name)

    return Response.json({ data: { stylists: rows } })
  } catch (err) {
    console.error('GET /api/facilities/[facilityId]/stylists error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ facilityId: string }> }) {
  try {
    const { facilityId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const access = await resolveFacilityWrite(user, facilityId, { requireManageTier: true })
    if (!access.ok) return Response.json({ error: access.error }, { status: access.status })

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 422 })
    }
    const wanted = parsed.data.assignments
    const ids = [...new Set(wanted.map((a) => a.stylistId))]

    // ONE batched select (max:1 pool) — active, non-demo; franchise admins may
    // only staff from their own pool (franchise stylists or home facilities in
    // the franchise).
    const [rows, facility] = await Promise.all([
      db.query.stylists.findMany({
        where: and(inArray(stylists.id, ids), eq(stylists.active, true), eq(stylists.isDemo, false)),
        columns: { id: true, name: true, stylistCode: true, color: true, facilityId: true, franchiseId: true },
      }),
      db.query.facilities.findFirst({ where: eq(facilities.id, facilityId), columns: { workingHours: true } }),
    ])
    if (rows.length !== ids.length) {
      return Response.json({ error: 'One or more stylists were not found' }, { status: 404 })
    }
    if (!access.isMaster && access.fu?.rawRole === 'super_admin') {
      const fr = await getUserFranchise(user.id)
      const ok = rows.every(
        (s) => (fr && s.franchiseId === fr.franchiseId) || (fr && s.facilityId && fr.facilityIds.includes(s.facilityId)),
      )
      if (!ok) return Response.json({ error: 'A stylist is outside your franchise' }, { status: 403 })
    }

    const hours = parsed.data.hours ?? {
      startTime: facility?.workingHours?.startTime ?? '08:00',
      endTime: facility?.workingHours?.endTime ?? '18:00',
    }

    let availabilityCreated = 0
    await db.transaction(async (tx) => {
      // Assignments — re-activate an inactive pair rather than erroring.
      await tx
        .insert(stylistFacilityAssignments)
        .values(
          wanted.map((a) => ({
            stylistId: a.stylistId,
            facilityId,
            commissionPercent: a.commissionPercent ?? null,
            active: true,
          })),
        )
        .onConflictDoUpdate({
          target: [stylistFacilityAssignments.stylistId, stylistFacilityAssignments.facilityId],
          set: { active: true, updatedAt: new Date() },
        })

      // Home facility only where unset — keeps the master-admin stylist count
      // meaningful without stealing a stylist's home from another community.
      await tx
        .update(stylists)
        .set({ facilityId, updatedAt: new Date() })
        .where(and(inArray(stylists.id, ids), isNull(stylists.facilityId)))

      // Availability — scoped delete + insert per (stylist, THIS facility).
      // Never unscoped: an unscoped delete wipes the stylist's other facilities.
      const withDays = wanted.filter((a) => a.days && a.days.length > 0)
      if (withDays.length > 0) {
        await tx
          .delete(stylistAvailability)
          .where(
            and(
              inArray(stylistAvailability.stylistId, withDays.map((a) => a.stylistId)),
              eq(stylistAvailability.facilityId, facilityId),
            ),
          )
        const values = withDays.flatMap((a) =>
          [...new Set(a.days!)].map((dayOfWeek) => ({
            stylistId: a.stylistId,
            facilityId,
            dayOfWeek,
            startTime: hours.startTime,
            endTime: hours.endTime,
            active: true,
          })),
        )
        await tx.insert(stylistAvailability).values(values).onConflictDoNothing()
        availabilityCreated = values.length
      }
    })

    revalidateTag('facilities', {})
    return Response.json({
      data: {
        assigned: ids.length,
        availabilityCreated,
        stylists: rows.map((s) => ({ id: s.id, name: s.name, stylistCode: s.stylistCode, color: s.color })),
      },
    })
  } catch (err) {
    console.error('POST /api/facilities/[facilityId]/stylists error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
