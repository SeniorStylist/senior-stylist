// P44 — owner review queue for AI-proposed shared learnings. The assistant
// (any non-master user's conversation) proposes generic learnings via the
// suggest_shared_learning tool; nothing takes effect until the master
// accepts it here with a chosen reach (global / facility / role).

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { assistantMemories, facilities, profiles } from '@/db/schema'
import { ensureAssistantMemorySchema } from '@/lib/assistant-memory-ddl'
import { desc, eq, inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

function isMasterAdmin(email: string | null | undefined) {
  const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!su && email === su
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isMasterAdmin(user.email)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    await ensureAssistantMemorySchema()

    const rows = await db.query.assistantMemories.findMany({
      where: eq(assistantMemories.status, 'proposed'),
      orderBy: [desc(assistantMemories.createdAt)],
      limit: 50,
    })

    // Batch-resolve proposer names + facility names (feedback-GET pattern).
    const userIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))]
    const facilityIds = [...new Set(rows.map((r) => r.facilityId).filter((v): v is string => !!v))]
    const [profileRows, facilityRows] = await Promise.all([
      userIds.length
        ? db.query.profiles.findMany({ where: inArray(profiles.id, userIds), columns: { id: true, fullName: true, email: true } })
        : Promise.resolve([]),
      facilityIds.length
        ? db.query.facilities.findMany({ where: inArray(facilities.id, facilityIds), columns: { id: true, name: true } })
        : Promise.resolve([]),
    ])
    const nameById = new Map(profileRows.map((p) => [p.id, p.fullName ?? p.email ?? '—']))
    const facilityById = new Map(facilityRows.map((f) => [f.id, f.name]))

    return Response.json({
      data: rows.map((r) => ({
        id: r.id,
        content: r.content,
        suggestedScope: r.scope,
        role: r.role,
        facilityId: r.facilityId,
        facilityName: r.facilityId ? facilityById.get(r.facilityId) ?? null : null,
        proposerName: r.userId ? nameById.get(r.userId) ?? '—' : '—',
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
      })),
    })
  } catch (err) {
    console.error('GET /api/super-admin/assistant-learnings error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
