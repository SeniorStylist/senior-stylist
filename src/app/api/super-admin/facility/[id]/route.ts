import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities, facilityUsers, bookings } from '@/db/schema'
import { count, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  timezone: z.string().optional(),
  paymentType: z.enum(['facility', 'ip', 'rfms', 'hybrid']).optional(),
  active: z.boolean().optional(),
  contactEmail: z.string().email().optional().nullable(),
})

async function getSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail || user.email !== superAdminEmail) return null
  return user
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Check name uniqueness (case-insensitive) among active facilities, excluding this one
    if (parsed.data.name) {
      const existing = await db.query.facilities.findFirst({
        where: (t, { and }) => and(
          sql`lower(${t.name}) = lower(${parsed.data.name!})`,
          eq(t.active, true),
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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSuperAdmin()
    if (!user) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params

    await db.transaction(async (tx) => {
      const [bookingCheck] = await tx
        .select({ count: count() })
        .from(bookings)
        .where(eq(bookings.facilityId, id))

      if ((bookingCheck?.count ?? 0) > 0) {
        throw new Error('HAS_BOOKINGS')
      }

      await tx.delete(facilityUsers).where(eq(facilityUsers.facilityId, id))
      await tx.delete(facilities).where(eq(facilities.id, id))
    })

    return Response.json({ data: { deleted: true } })
  } catch (err) {
    if (err instanceof Error && err.message === 'HAS_BOOKINGS') {
      return Response.json(
        { error: 'Cannot delete — facility has booking history. Deactivate it instead.' },
        { status: 409 }
      )
    }
    console.error('DELETE /api/super-admin/facility/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
