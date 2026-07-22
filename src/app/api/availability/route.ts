import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylistAvailability, stylists, stylistFacilityAssignments, profiles, facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { and, asc, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// Master-email bypass — same local pattern as /api/stylists/[id].
function isMasterAdmin(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

const availabilitySchema = z.object({
  stylistId: z.string().uuid(),
  // P39 — master admin only: which facility's schedule to write (masters have
  // no facility_users row). Admin/stylist callers are pinned to their own.
  facilityId: z.string().uuid().optional(),
  availability: z
    .array(
      z
        .object({
          dayOfWeek: z.number().int().min(0).max(6),
          startTime: z.string().regex(/^\d{2}:\d{2}$/),
          endTime: z.string().regex(/^\d{2}:\d{2}$/),
          active: z.boolean(),
        })
        .refine((d) => !d.active || d.startTime < d.endTime, {
          message: 'startTime must be before endTime when active',
        })
    )
    .max(7)
    .refine(
      (rows) => new Set(rows.map((r) => r.dayOfWeek)).size === rows.length,
      { message: 'dayOfWeek must be unique' }
    ),
})

/** Does the stylist work at this facility? Home row OR active assignment (F228 rule). */
async function stylistWorksAt(stylistId: string, facilityId: string): Promise<boolean> {
  const home = await db.query.stylists.findFirst({
    where: and(eq(stylists.id, stylistId), eq(stylists.facilityId, facilityId)),
    columns: { id: true },
  })
  if (home) return true
  const assignment = await db.query.stylistFacilityAssignments.findFirst({
    where: and(
      eq(stylistFacilityAssignments.stylistId, stylistId),
      eq(stylistFacilityAssignments.facilityId, facilityId),
      eq(stylistFacilityAssignments.active, true),
    ),
    columns: { id: true },
  })
  return !!assignment
}

/**
 * P39 — resolve the (caller, facility) scope for an availability read/write.
 * - master (env email, no facility row): any facility the stylist works at —
 *   the requested one, else the stylist's home facility / first assignment.
 * - admin/franchise: own selected facility (stylist must work there).
 * - stylist: self only, own selected facility.
 * Returns an error Response, or the resolved facilityId.
 */
async function resolveScope(
  user: { id: string; email?: string },
  stylistId: string,
  requestedFacilityId: string | null,
): Promise<{ facilityId: string } | Response> {
  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) {
    if (!isMasterAdmin(user.email)) {
      return Response.json({ error: 'No facility' }, { status: 400 })
    }
    // Master: derive the facility from the stylist when not specified.
    const stylist = await db.query.stylists.findFirst({
      where: eq(stylists.id, stylistId),
      columns: { id: true, facilityId: true },
    })
    if (!stylist) return Response.json({ error: 'Not found' }, { status: 404 })
    let facilityId = requestedFacilityId
    if (!facilityId) {
      facilityId = stylist.facilityId ?? null
      if (!facilityId) {
        const assignment = await db.query.stylistFacilityAssignments.findFirst({
          where: and(eq(stylistFacilityAssignments.stylistId, stylistId), eq(stylistFacilityAssignments.active, true)),
          columns: { facilityId: true },
        })
        facilityId = assignment?.facilityId ?? null
      }
    }
    if (!facilityId) {
      return Response.json({ error: 'This stylist has no facility to schedule at yet.' }, { status: 422 })
    }
    const fac = await db.query.facilities.findFirst({
      where: and(eq(facilities.id, facilityId), eq(facilities.active, true)),
      columns: { id: true },
    })
    if (!fac || !(await stylistWorksAt(stylistId, facilityId))) {
      return Response.json({ error: 'Stylist is not assigned to that facility' }, { status: 404 })
    }
    return { facilityId }
  }

  if (facilityUser.role !== 'admin') {
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { stylistId: true },
    })
    if (!profile?.stylistId || profile.stylistId !== stylistId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  // Home row OR active assignment (was home-only — 404'd legit edits for
  // assignment-linked stylists, the F228 roster class).
  if (!(await stylistWorksAt(stylistId, facilityUser.facilityId))) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  return { facilityId: facilityUser.facilityId }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const stylistId = request.nextUrl.searchParams.get('stylistId')
    const parsed = z.string().uuid().safeParse(stylistId)
    if (!parsed.success) return Response.json({ error: 'stylistId required' }, { status: 422 })
    const requestedFacility = request.nextUrl.searchParams.get('facilityId')
    const scope = await resolveScope(user, parsed.data, requestedFacility)
    if (scope instanceof Response) return scope

    const availability = await db.query.stylistAvailability.findMany({
      where: and(
        eq(stylistAvailability.stylistId, parsed.data),
        eq(stylistAvailability.facilityId, scope.facilityId)
      ),
      orderBy: [asc(stylistAvailability.dayOfWeek)],
    })

    return Response.json({ data: { availability } })
  } catch (err) {
    console.error('GET /api/availability error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const parsed = availabilitySchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 422 })
    }
    const { stylistId, availability } = parsed.data

    const scope = await resolveScope(user, stylistId, parsed.data.facilityId ?? null)
    if (scope instanceof Response) return scope

    const rows = availability.map((r) => ({
      stylistId,
      facilityId: scope.facilityId,
      dayOfWeek: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
      active: r.active,
    }))

    await db.transaction(async (tx) => {
      // Scope the delete to THIS facility — the table is keyed (stylist_id, facility_id,
      // day_of_week); an unscoped delete would wipe the stylist's availability at every
      // other facility they're assigned to.
      await tx
        .delete(stylistAvailability)
        .where(
          and(
            eq(stylistAvailability.stylistId, stylistId),
            eq(stylistAvailability.facilityId, scope.facilityId)
          )
        )
      if (rows.length > 0) {
        await tx.insert(stylistAvailability).values(rows)
      }
    })

    const updated = await db.query.stylistAvailability.findMany({
      where: and(
        eq(stylistAvailability.stylistId, stylistId),
        eq(stylistAvailability.facilityId, scope.facilityId)
      ),
      orderBy: [asc(stylistAvailability.dayOfWeek)],
    })

    return Response.json({ data: { availability: updated } })
  } catch (err) {
    console.error('PUT /api/availability error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
