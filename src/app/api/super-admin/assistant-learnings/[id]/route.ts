// P44 — accept (with edited text + chosen reach) or reject a proposed
// assistant learning. Master-gated; accept flips status 'proposed' →
// 'active' so every matching user's assistant follows it from then on.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { assistantMemories, facilities } from '@/db/schema'
import { ensureAssistantMemorySchema } from '@/lib/assistant-memory-ddl'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  action: z.enum(['accept', 'reject']),
  scope: z.enum(['global', 'facility', 'role']).optional(),
  facilityId: z.string().uuid().optional(),
  role: z.enum(['admin', 'facility_staff', 'bookkeeper', 'stylist']).optional(),
  content: z.string().min(2).max(300).optional(),
})

function isMasterAdmin(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isMasterAdmin(user.email)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 422 })
    const d = parsed.data

    await ensureAssistantMemorySchema()

    const existing = await db.query.assistantMemories.findFirst({
      where: and(eq(assistantMemories.id, id), eq(assistantMemories.status, 'proposed')),
    })
    if (!existing) return Response.json({ error: 'Not found or already reviewed' }, { status: 404 })

    if (d.action === 'reject') {
      await db.update(assistantMemories)
        .set({ status: 'rejected', updatedAt: new Date() })
        .where(eq(assistantMemories.id, id))
      return Response.json({ data: { status: 'rejected' } })
    }

    // accept — the owner picks the final reach and may edit the text.
    const scope = d.scope ?? (existing.scope === 'user' ? 'global' : (existing.scope as 'global' | 'facility' | 'role'))
    let facilityId: string | null = null
    let role: string | null = null
    if (scope === 'facility') {
      facilityId = d.facilityId ?? existing.facilityId
      if (!facilityId) return Response.json({ error: 'facilityId required for facility scope' }, { status: 422 })
      const fac = await db.query.facilities.findFirst({
        where: and(eq(facilities.id, facilityId), eq(facilities.active, true)),
        columns: { id: true },
      })
      if (!fac) return Response.json({ error: 'Facility not found' }, { status: 404 })
    }
    if (scope === 'role') {
      role = d.role ?? existing.role
      if (!role) return Response.json({ error: 'role required for role scope' }, { status: 422 })
    }

    await db.update(assistantMemories)
      .set({
        status: 'active',
        scope,
        facilityId,
        role,
        content: d.content?.trim() || existing.content,
        source: 'ai_observed',
        updatedAt: new Date(),
      })
      .where(eq(assistantMemories.id, id))

    return Response.json({ data: { status: 'active', scope } })
  } catch (err) {
    console.error('PATCH /api/super-admin/assistant-learnings/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
