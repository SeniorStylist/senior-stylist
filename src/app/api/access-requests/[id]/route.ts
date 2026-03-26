import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { accessRequests, profiles, facilityUsers } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'

const actionSchema = z.object({
  action: z.enum(['approve', 'deny']),
  role: z.enum(['stylist', 'admin', 'viewer']).optional(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (facilityUser.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params
    const body = await request.json()
    const parsed = actionSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Load the request — must belong to this facility
    const accessRequest = await db.query.accessRequests.findFirst({
      where: (t) => and(eq(t.id, id), eq(t.facilityId, facilityUser.facilityId)),
    })

    if (!accessRequest) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const { action, role } = parsed.data
    const assignRole = role ?? accessRequest.role ?? 'stylist'

    if (action === 'deny') {
      await db
        .update(accessRequests)
        .set({ status: 'denied', updatedAt: new Date() })
        .where(eq(accessRequests.id, id))

      return Response.json({ data: { denied: true } })
    }

    // approve
    await db
      .update(accessRequests)
      .set({ status: 'approved', updatedAt: new Date() })
      .where(eq(accessRequests.id, id))

    // If we have a userId, provision access
    if (accessRequest.userId) {
      await db
        .insert(profiles)
        .values({
          id: accessRequest.userId,
          email: accessRequest.email,
          fullName: accessRequest.fullName ?? null,
          avatarUrl: null,
        })
        .onConflictDoNothing()

      await db
        .insert(facilityUsers)
        .values({
          userId: accessRequest.userId,
          facilityId: accessRequest.facilityId,
          role: assignRole,
        })
        .onConflictDoNothing()
    }

    return Response.json({ data: { approved: true } })
  } catch (err) {
    console.error('PUT /api/access-requests/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
