// Promote a bookkeeper-created ad-hoc service (source='ocr_import') into the real
// facility price list (source='price_list') so it shows to families + staff.
// Admin/facility_staff only, facility-scoped. Optionally set a real price/category.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { services } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const schema = z.object({
  priceCents: z.number().int().min(0).max(10_000_000).optional(),
  category: z.string().max(200).nullable().optional(),
  durationMinutes: z.number().int().positive().max(1440).optional(),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = schema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    const existing = await db.query.services.findFirst({
      where: and(eq(services.id, id), eq(services.facilityId, facilityUser.facilityId)),
      columns: { id: true },
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    const set: Partial<typeof services.$inferInsert> = { source: 'price_list', updatedAt: new Date() }
    if (parsed.data.priceCents !== undefined) set.priceCents = parsed.data.priceCents
    if (parsed.data.category !== undefined) set.category = parsed.data.category
    if (parsed.data.durationMinutes !== undefined) set.durationMinutes = parsed.data.durationMinutes

    const [updated] = await db.update(services).set(set).where(eq(services.id, id)).returning()
    return Response.json({ data: updated })
  } catch (err) {
    console.error('POST /api/services/[id]/promote error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
