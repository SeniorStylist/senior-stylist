import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { services, facilities } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { eq, and, inArray } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const reorderSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('services'),
    // orderedIds: IDs in their new display order, all within the same category
    orderedIds: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal('categories'),
    orderedCategories: z.array(z.string().max(200)).min(1).max(100),
  }),
])

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!isAdminOrAbove(facilityUser.role) && !isFacilityStaff(facilityUser.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const parsed = reorderSchema.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 422 })

    if (parsed.data.action === 'services') {
      const { orderedIds } = parsed.data
      // Verify all IDs belong to this facility
      const rows = await db
        .select({ id: services.id })
        .from(services)
        .where(and(inArray(services.id, orderedIds), eq(services.facilityId, facilityUser.facilityId)))
      const ownedIds = new Set(rows.map((r) => r.id))
      const validIds = orderedIds.filter((id) => ownedIds.has(id))

      // Bulk update sort_order: position 1, 2, 3…
      await Promise.all(
        validIds.map((id, i) =>
          db.update(services).set({ sortOrder: i + 1 }).where(eq(services.id, id))
        )
      )
    } else {
      // categories
      await db
        .update(facilities)
        .set({ serviceCategoryOrder: parsed.data.orderedCategories })
        .where(eq(facilities.id, facilityUser.facilityId))
      revalidateTag('facilities', {})
    }

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[POST /api/services/reorder] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
