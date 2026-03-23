import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { services } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const bulkUpdateSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  updates: z
    .object({
      color: z.string().optional(),
      active: z.boolean().optional(),
    })
    .refine((u) => u.color !== undefined || u.active !== undefined, {
      message: 'At least one field must be provided',
    }),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const body = await request.json()
    const parsed = bulkUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { ids, updates } = parsed.data

    const updated = await db
      .update(services)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(services.facilityId, facilityId), inArray(services.id, ids)))
      .returning()

    return Response.json({ data: { updated: updated.length } })
  } catch (err) {
    console.error('POST /api/services/bulk-update error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
