import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { waitlistEntries } from '@/db/schema'
import { getUserFacility, isAdminOrAbove, isFacilityStaff } from '@/lib/get-facility-id'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { ensureWaitlistSchema } from '@/lib/waitlist-ddl'

// Soft-cancel only — waitlist entries are never hard-deleted (house rule).
const patchSchema = z.object({
  status: z.enum(['cancelled']).optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId, role } = facilityUser
    if (!isAdminOrAbove(role) && !isFacilityStaff(role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })

    await ensureWaitlistSchema()

    const { id } = await params
    const existing = await db.query.waitlistEntries.findFirst({
      where: and(eq(waitlistEntries.id, id), eq(waitlistEntries.facilityId, facilityId)),
      columns: { id: true, status: true },
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })
    if (existing.status !== 'pending') {
      return Response.json({ error: `Entry is ${existing.status} — cannot edit` }, { status: 409 })
    }

    const updates: Partial<typeof waitlistEntries.$inferInsert> = { updatedAt: new Date() }
    if (parsed.data.status) updates.status = parsed.data.status
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes?.trim() || null

    const [updated] = await db
      .update(waitlistEntries)
      .set(updates)
      .where(eq(waitlistEntries.id, id))
      .returning()

    return Response.json({ data: updated })
  } catch (err) {
    console.error('PATCH /api/waitlist/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
