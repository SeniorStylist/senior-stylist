import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { logEntries, profiles } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const updateSchema = z.object({
  notes: z.string().max(2000).optional(),
  finalized: z.boolean().optional(),
})

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    const { facilityId } = facilityUser

    const existing = await db.query.logEntries.findFirst({
      where: and(eq(logEntries.id, id), eq(logEntries.facilityId, facilityId)),
    })
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })

    // Stylists may only update their OWN log entry
    if (facilityUser.role === 'stylist') {
      const profile = await db.query.profiles.findFirst({
        where: eq(profiles.id, user.id),
        columns: { stylistId: true },
      })
      if (!profile?.stylistId || profile.stylistId !== existing.stylistId) {
        return Response.json({ error: 'Forbidden — not your log entry' }, { status: 403 })
      }
    }

    const body = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      const i = parsed.error.issues[0]
      return Response.json({ error: `Invalid data — ${i?.message ?? 'check your input'}` }, { status: 422 })
    }

    const [updated] = await db
      .update(logEntries)
      .set({
        notes: parsed.data.notes ?? existing.notes,
        finalized: parsed.data.finalized ?? existing.finalized,
        finalizedAt:
          parsed.data.finalized === false
            ? null
            : parsed.data.finalized && !existing.finalized
            ? new Date()
            : existing.finalizedAt,
        updatedAt: new Date(),
      })
      .where(and(eq(logEntries.id, id), eq(logEntries.facilityId, facilityId)))
      .returning()

    return Response.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/log/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
