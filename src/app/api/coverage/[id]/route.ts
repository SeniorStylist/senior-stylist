import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { coverageRequests, profiles, stylists } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { sendEmail, buildCoverageFilledEmailHtml } from '@/lib/email'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const STATUS_VALUES = ['open', 'filled', 'cancelled'] as const

const updateSchema = z
  .object({
    status: z.enum(STATUS_VALUES).optional(),
    substituteStylistId: z.string().uuid().nullable().optional(),
    reason: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.substituteStylistId !== undefined || v.reason !== undefined,
    { message: 'At least one field is required' }
  )

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const existing = await db.query.coverageRequests.findFirst({
      where: and(eq(coverageRequests.id, id), eq(coverageRequests.facilityId, facilityUser.facilityId)),
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 422 })
    }

    const isAdmin = facilityUser.role === 'admin'

    if (!isAdmin) {
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { stylistId: true },
      })
      if (!profile?.stylistId || profile.stylistId !== existing.stylistId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      const onlyCancelling =
        parsed.data.status === 'cancelled' &&
        parsed.data.substituteStylistId === undefined &&
        parsed.data.reason === undefined
      if (!onlyCancelling || existing.status !== 'open') {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }

      const [updated] = await db
        .update(coverageRequests)
        .set({
          status: 'cancelled',
          substituteStylistId: null,
          assignedBy: null,
          assignedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(coverageRequests.id, id))
        .returning()
      return Response.json({ data: { request: updated } })
    }

    const updates: Partial<typeof coverageRequests.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (parsed.data.reason !== undefined) updates.reason = parsed.data.reason
    if (parsed.data.substituteStylistId !== undefined) {
      updates.substituteStylistId = parsed.data.substituteStylistId
    }

    let fireFilledEmail = false
    let substituteName: string | null = null

    if (parsed.data.status !== undefined) {
      updates.status = parsed.data.status
      if (parsed.data.status === 'filled') {
        const subId = parsed.data.substituteStylistId ?? existing.substituteStylistId
        if (!subId) {
          return Response.json({ error: 'substituteStylistId required to fill' }, { status: 422 })
        }
        if (subId === existing.stylistId) {
          return Response.json({ error: 'Substitute cannot be the requester' }, { status: 422 })
        }
        const sub = await db.query.stylists.findFirst({
          where: and(
            eq(stylists.id, subId),
            eq(stylists.facilityId, facilityUser.facilityId),
            eq(stylists.active, true)
          ),
          columns: { id: true, name: true },
        })
        if (!sub) return Response.json({ error: 'Substitute not found' }, { status: 422 })
        updates.substituteStylistId = sub.id
        updates.assignedBy = user.id
        updates.assignedAt = new Date()
        fireFilledEmail = true
        substituteName = sub.name
      } else if (parsed.data.status === 'cancelled') {
        updates.substituteStylistId = null
        updates.assignedBy = null
        updates.assignedAt = null
      }
    }

    const [updated] = await db
      .update(coverageRequests)
      .set(updates)
      .where(eq(coverageRequests.id, id))
      .returning()

    if (fireFilledEmail && updated) {
      try {
        const requester = await db.query.stylists.findFirst({
          where: eq(stylists.id, updated.stylistId),
          columns: { id: true, name: true },
        })
        const requesterProfile = await db.query.profiles.findFirst({
          where: eq(profiles.stylistId, updated.stylistId),
          columns: { email: true },
        })
        const facility = await db.query.facilities.findFirst({
          where: (f, { eq: eqOp }) => eqOp(f.id, facilityUser.facilityId),
          columns: { name: true },
        })
        if (requesterProfile?.email && requester && substituteName) {
          const html = buildCoverageFilledEmailHtml({
            stylistName: requester.name,
            substituteName,
            requestedDate: updated.requestedDate,
            facilityName: facility?.name ?? 'Facility',
          })
          const subject = `Coverage confirmed for ${updated.requestedDate}`
          sendEmail({ to: requesterProfile.email, subject, html }).catch((err) =>
            console.error('[coverage PUT] send failed:', err)
          )
        }
      } catch (emailErr) {
        console.error('[coverage PUT] email setup failed:', emailErr)
      }
    }

    return Response.json({ data: { request: updated } })
  } catch (err) {
    console.error('PUT /api/coverage/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })

    const existing = await db.query.coverageRequests.findFirst({
      where: and(eq(coverageRequests.id, id), eq(coverageRequests.facilityId, facilityUser.facilityId)),
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    if (facilityUser.role !== 'admin') {
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { stylistId: true },
      })
      if (
        !profile?.stylistId ||
        profile.stylistId !== existing.stylistId ||
        existing.status !== 'open'
      ) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    await db.delete(coverageRequests).where(eq(coverageRequests.id, id))
    return Response.json({ data: { deleted: true } })
  } catch (err) {
    console.error('DELETE /api/coverage/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
