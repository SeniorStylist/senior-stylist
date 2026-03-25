import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  timezone: z.string().optional(),
  paymentType: z.enum(['facility', 'ip', 'rfms', 'hybrid']).optional(),
  active: z.boolean().optional(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!superAdminEmail || user.email !== superAdminEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = params
    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Check name uniqueness (case-insensitive), excluding this facility
    if (parsed.data.name) {
      const existing = await db.query.facilities.findFirst({
        where: (t, { and }) => and(
          sql`lower(${t.name}) = lower(${parsed.data.name!})`,
          ne(t.id, id)
        ),
      })
      if (existing) {
        return Response.json({ error: 'A facility with this name already exists' }, { status: 409 })
      }
    }

    const [updated] = await db
      .update(facilities)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(facilities.id, id))
      .returning()

    if (!updated) {
      return Response.json({ error: 'Facility not found' }, { status: 404 })
    }

    return Response.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/super-admin/facility/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
