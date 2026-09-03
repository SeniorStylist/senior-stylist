import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { qbSyncRuns } from '@/db/schema'
import { desc, eq } from 'drizzle-orm'
import { getUserFacility, canManageQuickBooksBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { ensureQbSafetySchema } from '@/lib/qb-safety-ddl'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sync history for the Settings → QuickBooks card (last 30 runs, newest first). */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    let facilityId: string
    const requested = request.nextUrl.searchParams.get('facilityId')
    if (isMaster && requested) {
      if (!UUID_RE.test(requested)) return Response.json({ error: 'Invalid facilityId' }, { status: 400 })
      facilityId = requested
    } else {
      const fu = await getUserFacility(user.id)
      if (!fu) return Response.json({ error: 'No facility' }, { status: 400 })
      if (!canManageQuickBooksBilling(fu.role)) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (requested && requested !== fu.facilityId) return Response.json({ error: 'Forbidden' }, { status: 403 })
      facilityId = fu.facilityId
    }

    const rl = await checkRateLimit('qbRuns', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    await ensureQbSafetySchema()
    const runs = await db.query.qbSyncRuns.findMany({
      where: eq(qbSyncRuns.facilityId, facilityId),
      orderBy: desc(qbSyncRuns.startedAt),
      limit: 30,
      columns: {
        id: true,
        action: true,
        startedAt: true,
        createdBy: true,
        summary: true,
        undoneAt: true,
        undoSummary: true,
      },
    })

    return Response.json({
      data: {
        runs: runs.map((r) => ({
          id: r.id,
          action: r.action,
          startedAt: r.startedAt.toISOString(),
          automated: !r.createdBy,
          summary: r.summary ?? {},
          undoneAt: r.undoneAt?.toISOString() ?? null,
          undoSummary: r.undoSummary ?? null,
        })),
      },
    })
  } catch (err) {
    console.error('[quickbooks/runs] error:', err)
    return Response.json({ error: (err as Error).message ?? 'Internal server error' }, { status: 500 })
  }
}
