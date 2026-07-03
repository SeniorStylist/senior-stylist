import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { coverageRequests, profiles, stylists } from '@/db/schema'
import { getUserFacility, getUserFranchise } from '@/lib/get-facility-id'
import { sendEmail, buildCoverageFilledEmailHtml, buildCoverageDecisionEmailHtml } from '@/lib/email'
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
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // 13F: admin decision on a pending request
    action: z.enum(['approve', 'deny']).optional(),
    deniedReason: z.string().max(500).optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.substituteStylistId !== undefined ||
      v.reason !== undefined ||
      v.startDate !== undefined ||
      v.endDate !== undefined ||
      v.action !== undefined,
    { message: 'At least one field is required' },
  )
  .refine(
    (v) => {
      if (v.startDate && v.endDate) return v.endDate >= v.startDate
      return true
    },
    { message: 'endDate must be on or after startDate' },
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
        parsed.data.reason === undefined &&
        parsed.data.action === undefined
      // 13F: a stylist may cancel their own request while it's pending OR approved-open
      if (!onlyCancelling || (existing.status !== 'open' && existing.status !== 'pending')) {
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

    // ── 13F: admin decision on a pending request ────────────────────────────
    if (parsed.data.action) {
      if (existing.status !== 'pending') {
        return Response.json({ error: 'Only pending requests can be approved or denied' }, { status: 422 })
      }
      const approved = parsed.data.action === 'approve'
      const [decided] = await db
        .update(coverageRequests)
        .set(
          approved
            ? { status: 'open', approvedBy: user.id, approvedAt: new Date(), deniedReason: null, updatedAt: new Date() }
            : { status: 'denied', approvedBy: user.id, approvedAt: new Date(), deniedReason: parsed.data.deniedReason ?? null, updatedAt: new Date() },
        )
        .where(eq(coverageRequests.id, id))
        .returning()

      // Notify the requesting stylist — background send, fire-and-forget.
      try {
        const requester = await db.query.stylists.findFirst({
          where: eq(stylists.id, existing.stylistId),
          columns: { id: true, name: true },
        })
        const requesterProfile = await db.query.profiles.findFirst({
          where: eq(profiles.stylistId, existing.stylistId),
          columns: { email: true },
        })
        const facility = await db.query.facilities.findFirst({
          where: (f, { eq: eqOp }) => eqOp(f.id, facilityUser.facilityId),
          columns: { name: true },
        })
        if (requesterProfile?.email && requester) {
          const html = buildCoverageDecisionEmailHtml({
            stylistName: requester.name,
            approved,
            startDate: existing.startDate,
            endDate: existing.endDate,
            facilityName: facility?.name ?? 'Facility',
            deniedReason: parsed.data.deniedReason ?? null,
          })
          const rangeLabel =
            existing.startDate === existing.endDate
              ? existing.startDate
              : `${existing.startDate} – ${existing.endDate}`
          sendEmail({
            to: requesterProfile.email,
            subject: approved ? `Time off approved for ${rangeLabel}` : `Time off request for ${rangeLabel}`,
            html,
          }).catch((err) => console.error('[coverage PUT decision] send failed:', err))
        }
      } catch (emailErr) {
        console.error('[coverage PUT decision] email setup failed:', emailErr)
      }

      return Response.json({ data: { request: decided } })
    }

    const updates: Partial<typeof coverageRequests.$inferInsert> = {
      updatedAt: new Date(),
    }

    if (parsed.data.reason !== undefined) updates.reason = parsed.data.reason
    if (parsed.data.substituteStylistId !== undefined) {
      updates.substituteStylistId = parsed.data.substituteStylistId
    }
    if (parsed.data.startDate !== undefined) updates.startDate = parsed.data.startDate
    if (parsed.data.endDate !== undefined) updates.endDate = parsed.data.endDate

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
          where: and(eq(stylists.id, subId), eq(stylists.active, true)),
          columns: { id: true, name: true, facilityId: true, franchiseId: true },
        })
        if (!sub) return Response.json({ error: 'Substitute not found' }, { status: 422 })
        // Accept if in facility OR in same franchise pool (facilityId null + franchiseId matches)
        const callerFranchise = await getUserFranchise(user.id)
        const isFacilityMatch = sub.facilityId === facilityUser.facilityId
        const isFranchisePool =
          sub.facilityId === null &&
          !!callerFranchise &&
          sub.franchiseId === callerFranchise.franchiseId
        if (!isFacilityMatch && !isFranchisePool) {
          return Response.json({ error: 'Substitute not in facility or franchise' }, { status: 422 })
        }
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
            startDate: updated.startDate,
            endDate: updated.endDate,
            facilityName: facility?.name ?? 'Facility',
          })
          const rangeLabel =
            updated.startDate === updated.endDate
              ? updated.startDate
              : `${updated.startDate} – ${updated.endDate}`
          const subject = `Coverage confirmed for ${rangeLabel}`
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
        (existing.status !== 'open' && existing.status !== 'pending')
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
