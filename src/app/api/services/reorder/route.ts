import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { db } from '@/db'
import { services, facilities } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { revalidateTag } from 'next/cache'

const schema = z
  .object({
    orderedIds: z.array(z.string().uuid()).max(200).optional(),
    orderedCategories: z.array(z.string().max(200)).max(50).optional(),
  })
  .refine((d) => d.orderedIds !== undefined || d.orderedCategories !== undefined, {
    message: 'Provide orderedIds or orderedCategories',
  })

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const facilityUser = await getUserFacility(user.id)
  if (!facilityUser) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  if (facilityUser.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { facilityId } = facilityUser

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const { orderedIds, orderedCategories } = parsed.data

  try {
    if (orderedIds !== undefined) {
      await Promise.all(
        orderedIds.map((id, i) =>
          db
            .update(services)
            .set({ sortOrder: i })
            .where(and(eq(services.id, id), eq(services.facilityId, facilityId)))
        )
      )
    }

    if (orderedCategories !== undefined) {
      await db
        .update(facilities)
        .set({ serviceCategoryOrder: orderedCategories })
        .where(eq(facilities.id, facilityId))
    }

    revalidateTag('facilities', {})

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('[POST /api/services/reorder]', err)
    return Response.json({ error: 'Failed to save order' }, { status: 500 })
  }
}
