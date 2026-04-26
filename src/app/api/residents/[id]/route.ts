import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  roomNumber: z.string().max(50).optional(),
  phone: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
  active: z.boolean().optional(),
  defaultServiceId: z.string().uuid().nullable().optional(),
  poaName: z.string().max(200).optional(),
  poaEmail: z.string().max(320).optional(),
  poaPhone: z.string().max(50).optional(),
  poaPaymentMethod: z.string().max(100).optional(),
  poaNotificationsEnabled: z.boolean().optional(),
})

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

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const data = await db.query.residents.findFirst({
      where: and(eq(residents.id, id), eq(residents.facilityId, facilityId)),
    })

    if (!data) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/residents/[id] error:', err)
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

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const [updated] = await db
      .update(residents)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(residents.id, id), eq(residents.facilityId, facilityId)))
      .returning()

    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/residents/[id] error:', err)
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

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { facilityId } = facilityUser

    const [updated] = await db
      .update(residents)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(residents.id, id), eq(residents.facilityId, facilityId)))
      .returning()

    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data: updated })
  } catch (err) {
    console.error('DELETE /api/residents/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
