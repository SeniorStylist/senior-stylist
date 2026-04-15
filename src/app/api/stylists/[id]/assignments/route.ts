import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists, stylistFacilityAssignments, facilities, franchiseFacilities } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { eq, and, inArray, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const bodySchema = z.object({
  facilityId: z.string().uuid(),
  commissionPercent: z.number().int().min(0).max(100).nullable().optional(),
  active: z.boolean().optional().default(true),
})

function isMasterAdmin(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

async function getStylistAndScope(
  stylistId: string,
  userId: string,
  master: boolean,
): Promise<{
  stylist: typeof stylists.$inferSelect
  allowedFacilityIds: string[]
  franchiseId: string | null
  franchiseFacilityIds: string[]
} | null> {
  const facilityUser = master ? null : await getUserFacility(userId)
  if (!master && !facilityUser) return null
  if (!master && facilityUser!.role !== 'admin') return null

  const franchise = master ? null : await getUserFranchise(userId)
  const allowedFacilityIds =
    franchise?.facilityIds ?? (facilityUser ? [facilityUser.facilityId] : [])

  const row = await db.query.stylists.findFirst({ where: eq(stylists.id, stylistId) })
  if (!row) return null

  if (!master) {
    const owned =
      (row.facilityId && allowedFacilityIds.includes(row.facilityId)) ||
      (franchise && row.franchiseId === franchise.franchiseId)
    if (!owned) return null
  }

  // Fetch all facilities in the franchise for POST validation
  let franchiseFacilityIds: string[] = []
  if (franchise) {
    const rows = await db
      .select({ facilityId: franchiseFacilities.facilityId })
      .from(franchiseFacilities)
      .where(eq(franchiseFacilities.franchiseId, franchise.franchiseId))
    franchiseFacilityIds = rows.map((r) => r.facilityId)
  } else if (facilityUser) {
    franchiseFacilityIds = [facilityUser.facilityId]
  }

  return {
    stylist: row,
    allowedFacilityIds,
    franchiseId: franchise?.franchiseId ?? null,
    franchiseFacilityIds,
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const master = isMasterAdmin(user.email)
    const scope = await getStylistAndScope(id, user.id, master)
    if (!scope) return Response.json({ error: 'Not found' }, { status: 404 })

    const rows = await db
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
      .where(eq(stylistFacilityAssignments.stylistId, id))
      .orderBy(facilities.name)

    return Response.json({ data: { assignments: rows } })
  } catch (err) {
    console.error('GET /api/stylists/[id]/assignments error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
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

    const scope = await getStylistAndScope(id, user.id, master)
    if (!scope) return Response.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Validate facilityId belongs to caller's franchise (or master admin)
    if (!master && !scope.franchiseFacilityIds.includes(parsed.data.facilityId)) {
      return Response.json({ error: 'Facility not in your franchise' }, { status: 403 })
    }

    const [row] = await db
      .insert(stylistFacilityAssignments)
      .values({
        stylistId: id,
        facilityId: parsed.data.facilityId,
        commissionPercent: parsed.data.commissionPercent ?? null,
        active: parsed.data.active ?? true,
      })
      .onConflictDoUpdate({
        target: [stylistFacilityAssignments.stylistId, stylistFacilityAssignments.facilityId],
        set: {
          commissionPercent: parsed.data.commissionPercent ?? null,
          active: parsed.data.active ?? true,
          updatedAt: new Date(),
        },
      })
      .returning()

    // Fetch with facility name
    const [withName] = await db
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
      .where(eq(stylistFacilityAssignments.id, row.id))

    return Response.json({ data: { assignment: withName } })
  } catch (err) {
    console.error('POST /api/stylists/[id]/assignments error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
