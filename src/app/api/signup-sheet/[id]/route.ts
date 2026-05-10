import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { signupSheetEntries, profiles, stylistFacilityAssignments } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'

const patchSchema = z.object({
  status: z.enum(['pending', 'cancelled']).optional(),
  assignedToStylistId: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  requestedTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId, role } = facilityUser

    const { id } = await params
    const existing = await db.query.signupSheetEntries.findFirst({
      where: and(eq(signupSheetEntries.id, id), eq(signupSheetEntries.facilityId, facilityId)),
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    if (existing.status === 'scheduled') {
      return Response.json({ error: 'Entry already scheduled — cannot edit' }, { status: 409 })
    }

    const body = await request.json()
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Permission gate: stylists can only edit `notes` on entries assigned to them.
    if (role === 'stylist') {
      const myProfile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { stylistId: true },
      })
      if (!myProfile?.stylistId || existing.assignedToStylistId !== myProfile.stylistId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const allowed = ['notes'] as const
      const submitted = Object.keys(parsed.data)
      if (submitted.some((k) => !allowed.includes(k as typeof allowed[number]))) {
        return Response.json({ error: 'Stylists may only edit notes' }, { status: 403 })
      }
    } else if (!isAdminOrAbove(role) && !isFacilityStaff(role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (parsed.data.assignedToStylistId) {
      const [assignment] = await db
        .select({ id: stylistFacilityAssignments.id })
        .from(stylistFacilityAssignments)
        .where(and(
          eq(stylistFacilityAssignments.stylistId, parsed.data.assignedToStylistId),
          eq(stylistFacilityAssignments.facilityId, facilityId),
          eq(stylistFacilityAssignments.active, true),
        ))
        .limit(1)
      if (!assignment) return Response.json({ error: 'Stylist is not assigned to this facility' }, { status: 404 })
    }

    const updates: Partial<typeof signupSheetEntries.$inferInsert> = { updatedAt: new Date() }
    if (parsed.data.status !== undefined) updates.status = parsed.data.status
    if (parsed.data.assignedToStylistId !== undefined) updates.assignedToStylistId = parsed.data.assignedToStylistId
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes
    if (parsed.data.requestedTime !== undefined) updates.requestedTime = parsed.data.requestedTime

    const [updated] = await db
      .update(signupSheetEntries)
      .set(updates)
      .where(eq(signupSheetEntries.id, id))
      .returning()

    revalidateTag('signup-sheet', {})

    const full = await db.query.signupSheetEntries.findFirst({
      where: eq(signupSheetEntries.id, updated.id),
      with: { resident: true, service: true, assignedStylist: true },
    })

    return Response.json({ data: full ?? updated })
  } catch (err) {
    console.error('PATCH /api/signup-sheet/[id] failed:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
