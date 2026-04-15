import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists, stylistFacilityAssignments, facilities } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const bodySchema = z.object({
  commissionPercent: z.number().int().min(0).max(100).nullable().optional(),
  active: z.boolean().optional(),
})

function isMasterAdmin(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; assignmentId: string }> },
) {
  try {
    const { id, assignmentId } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const master = isMasterAdmin(user.email)
    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!master && facilityUser!.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const franchise = master ? null : await getUserFranchise(user.id)
    const allowedFacilityIds =
      franchise?.facilityIds ?? (facilityUser ? [facilityUser.facilityId] : [])

    // Verify target stylist is in scope
    const stylist = await db.query.stylists.findFirst({ where: eq(stylists.id, id) })
    if (!stylist) return Response.json({ error: 'Not found' }, { status: 404 })
    if (!master) {
      const owned =
        (stylist.facilityId && allowedFacilityIds.includes(stylist.facilityId)) ||
        (franchise && stylist.franchiseId === franchise.franchiseId)
      if (!owned) return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // Load the assignment
    const existing = await db.query.stylistFacilityAssignments.findFirst({
      where: and(
        eq(stylistFacilityAssignments.id, assignmentId),
        eq(stylistFacilityAssignments.stylistId, id),
      ),
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    // Verify assignment's facilityId is in scope
    if (!master && !allowedFacilityIds.includes(existing.facilityId)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (parsed.data.commissionPercent !== undefined) {
      updateData.commissionPercent = parsed.data.commissionPercent
    }
    if (parsed.data.active !== undefined) {
      updateData.active = parsed.data.active
    }

    await db
      .update(stylistFacilityAssignments)
      .set(updateData)
      .where(eq(stylistFacilityAssignments.id, assignmentId))

    // Return with facility name
    const [updated] = await db
      .select({
        id: stylistFacilityAssignments.id,
        stylistId: stylistFacilityAssignments.stylistId,
        facilityId: stylistFacilityAssignments.facilityId,
        facilityName: facilities.name,
        commissionPercent: stylistFacilityAssignments.commissionPercent,
        active: stylistFacilityAssignments.active,
        createdAt: stylistFacilityAssignments.createdAt,
        updatedAt: stylistFacilityAssignments.updatedAt,
      })
      .from(stylistFacilityAssignments)
      .innerJoin(facilities, eq(facilities.id, stylistFacilityAssignments.facilityId))
      .where(eq(stylistFacilityAssignments.id, assignmentId))

    return Response.json({ data: { assignment: updated } })
  } catch (err) {
    console.error('PUT /api/stylists/[id]/assignments/[assignmentId] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
