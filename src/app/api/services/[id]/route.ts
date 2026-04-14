import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { services } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const pricingTierSchema = z.object({
  minQty: z.number().int().min(1),
  maxQty: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
})

const pricingOptionSchema = z.object({
  name: z.string().min(1),
  priceCents: z.number().int().min(0),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  priceCents: z.number().int().min(0).optional(),
  durationMinutes: z.number().int().positive().optional(),
  description: z.string().optional(),
  color: z.string().optional(),
  active: z.boolean().optional(),
  pricingType: z.enum(['fixed', 'addon', 'tiered', 'multi_option']).optional(),
  addonAmountCents: z.number().int().min(0).nullable().optional(),
  pricingTiers: z.array(pricingTierSchema).nullable().optional(),
  pricingOptions: z.array(pricingOptionSchema).nullable().optional(),
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

    const data = await db.query.services.findFirst({
      where: and(eq(services.id, id), eq(services.facilityId, facilityId)),
    })

    if (!data) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data })
  } catch (err) {
    console.error('GET /api/services/[id] error:', err)
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
      .update(services)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(services.id, id), eq(services.facilityId, facilityId)))
      .returning()

    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/services/[id] error:', err)
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
      .update(services)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(services.id, id), eq(services.facilityId, facilityId)))
      .returning()

    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data: updated })
  } catch (err) {
    console.error('DELETE /api/services/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
