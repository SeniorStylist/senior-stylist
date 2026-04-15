import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { sanitizeStylist } from '@/lib/sanitize'
import { eq, and, or, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  color: z.string().max(20).optional(),
  commissionPercent: z.number().int().min(0).max(100).optional(),
  active: z.boolean().optional(),
  licenseNumber: z.string().max(100).nullable().optional(),
  licenseType: z.string().max(100).nullable().optional(),
  licenseState: z.string().max(200).nullable().optional(),
  licenseExpiresAt: dateString.nullable().optional(),
  insuranceExpiresAt: dateString.nullable().optional(),
  facilityId: z.string().uuid().nullable().optional(),
  franchiseId: z.string().uuid().nullable().optional(),
  stylistCode: z.string().regex(/^ST\d{3,}$/).optional(),
  email: z.string().email().max(320).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  paymentMethod: z.string().max(50).nullable().optional(),
  scheduleNotes: z.string().max(2000).nullable().optional(),
})

function isMasterAdmin(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const franchise = master ? null : await getUserFranchise(user.id)
    const allowedFacilityIds = franchise?.facilityIds ?? [facilityUser!.facilityId]

    const whereClause = master
      ? eq(stylists.id, id)
      : and(
          eq(stylists.id, id),
          or(
            inArray(stylists.facilityId, allowedFacilityIds),
            franchise
              ? and(eq(stylists.franchiseId, franchise.franchiseId), isNull(stylists.facilityId))
              : and(eq(stylists.id, id), isNull(stylists.facilityId), isNull(stylists.franchiseId)),
          ),
        )

    const data = await db.query.stylists.findFirst({ where: whereClause })

    if (!data) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data: sanitizeStylist(data) })
  } catch (err) {
    console.error('GET /api/stylists/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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

    const master = isMasterAdmin(user.email)
    const facilityUser = master ? null : await getUserFacility(user.id)
    if (!master && !facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!master && facilityUser!.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // stylist_code edits: master admin only
    if (parsed.data.stylistCode && !master) {
      return Response.json({ error: 'Only master admin can change stylist_code' }, { status: 403 })
    }

    const franchise = master ? null : await getUserFranchise(user.id)
    const allowedFacilityIds = franchise?.facilityIds ?? (facilityUser ? [facilityUser.facilityId] : [])

    // Load existing row + scope guard
    const existing = await db.query.stylists.findFirst({ where: eq(stylists.id, id) })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    if (!master) {
      const ownsExisting =
        (existing.facilityId && allowedFacilityIds.includes(existing.facilityId)) ||
        (existing.franchiseId && franchise && existing.franchiseId === franchise.franchiseId)
      if (!ownsExisting) return Response.json({ error: 'Not found' }, { status: 404 })
    }

    // Validate new facilityId (if provided) is in scope
    if (parsed.data.facilityId !== undefined && parsed.data.facilityId !== null && !master) {
      if (!allowedFacilityIds.includes(parsed.data.facilityId)) {
        return Response.json({ error: 'Facility not in your scope' }, { status: 403 })
      }
    }

    // Cross-franchise moves require master admin
    if (parsed.data.franchiseId !== undefined && !master) {
      if (parsed.data.franchiseId !== (franchise?.franchiseId ?? null)) {
        return Response.json(
          { error: 'Cross-franchise moves require master admin' },
          { status: 403 },
        )
      }
    }

    try {
      const [updated] = await db
        .update(stylists)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(stylists.id, id))
        .returning()

      if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })

      return Response.json({ data: sanitizeStylist(updated) })
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code?: string }).code === '23505'
      ) {
        return Response.json({ error: 'stylist_code already in use' }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    console.error('PUT /api/stylists/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const franchise = master ? null : await getUserFranchise(user.id)
    const allowedFacilityIds = franchise?.facilityIds ?? (facilityUser ? [facilityUser.facilityId] : [])

    const existing = await db.query.stylists.findFirst({ where: eq(stylists.id, id) })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    if (!master) {
      const ownsExisting =
        (existing.facilityId && allowedFacilityIds.includes(existing.facilityId)) ||
        (existing.franchiseId && franchise && existing.franchiseId === franchise.franchiseId)
      if (!ownsExisting) return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const [updated] = await db
      .update(stylists)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(stylists.id, id))
      .returning()

    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data: sanitizeStylist(updated) })
  } catch (err) {
    console.error('DELETE /api/stylists/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
