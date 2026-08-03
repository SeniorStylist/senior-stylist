// P50-C7 — mark the portal account's first-login welcome flow done (finish OR
// skip both land here). Session-gated; idempotent (only stamps when null).

import { db } from '@/db'
import { portalAccounts } from '@/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { getPortalSession } from '@/lib/portal-auth'
import { ensurePortalClaimsSchema } from '@/lib/portal-claims-ddl'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const session = await getPortalSession()
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('portalProfileUpdate', session.portalAccountId)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    await ensurePortalClaimsSchema()
    await db
      .update(portalAccounts)
      .set({ onboardedAt: new Date() })
      .where(and(eq(portalAccounts.id, session.portalAccountId), isNull(portalAccounts.onboardedAt)))

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/portal/onboarding-complete error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
