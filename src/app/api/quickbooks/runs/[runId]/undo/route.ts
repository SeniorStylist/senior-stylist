import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { qbSyncRuns, quickbooksSyncLog } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getUserFacility, canManageQuickBooksBilling } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { ensureQbSafetySchema } from '@/lib/qb-safety-ddl'
import { undoSyncRun } from '@/lib/qb-undo'
import { revalidateTag } from 'next/cache'
import { NextRequest } from 'next/server'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Reverses one recorded QuickBooks run (see src/lib/qb-undo.ts for exactly
// what each action unwinds and what it refuses to touch). Manage tier + master.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params
    if (!UUID_RE.test(runId)) return Response.json({ error: 'Invalid run id' }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    await ensureQbSafetySchema()
    const run = await db.query.qbSyncRuns.findFirst({
      where: eq(qbSyncRuns.id, runId),
      columns: { id: true, facilityId: true, action: true, undoneAt: true },
    })
    if (!run) return Response.json({ error: 'Run not found' }, { status: 404 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL &&
      user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!isMaster) {
      const fu = await getUserFacility(user.id)
      if (!fu || !canManageQuickBooksBilling(fu.role) || fu.facilityId !== run.facilityId) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
    if (run.undoneAt) return Response.json({ error: 'This run was already undone' }, { status: 409 })

    const rl = await checkRateLimit('qbUndo', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const result = await undoSyncRun(runId, user.id)

    db.insert(quickbooksSyncLog)
      .values({
        facilityId: run.facilityId,
        action: `undo_${run.action}`,
        status: result.errors.length > 0 ? 'error' : 'success',
        errorMessage: result.errors.length > 0 ? result.errors.slice(0, 3).join(' | ').slice(0, 500) : null,
        responseSummary: `${result.reversed} reversed, ${result.skipped} skipped`,
      })
      .catch((e) => console.error('[qb-log]', e))

    revalidateTag('billing', {})
    revalidateTag('facilities', {})

    return Response.json({ data: result })
  } catch (err) {
    console.error('[quickbooks/runs/undo] error:', err)
    return Response.json({ error: (err as Error).message ?? 'Internal server error' }, { status: 500 })
  }
}
