import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
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
  licenseExpiresAt: dateString.nullable().optional(),
  insuranceExpiresAt: dateString.nullable().optional(),
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

    const data = await db.query.stylists.findFirst({
      where: and(eq(stylists.id, id), eq(stylists.facilityId, facilityId)),
    })

    if (!data) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data })
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

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })
    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const [updated] = await db
      .update(stylists)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(stylists.id, id), eq(stylists.facilityId, facilityId)))
      .returning()

    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data: updated })
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

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })
    const { facilityId } = facilityUser

    const [updated] = await db
      .update(stylists)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(stylists.id, id), eq(stylists.facilityId, facilityId)))
      .returning()

    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data: updated })
  } catch (err) {
    console.error('DELETE /api/stylists/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
