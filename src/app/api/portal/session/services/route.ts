// Phase 16 G12 — fixed-price service list for the portal's prepay package
// presets. Portal SESSION auth (cookie), scoped to a resident linked to the
// caller's account; price_list catalog only; explicit columns.

import { db } from '@/db'
import { residents, services } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await getPortalSession()
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('portalServices', `pa:${session.portalAccountId}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const residentId = request.nextUrl.searchParams.get('residentId')
    const match = session.residents.find((r) => r.residentId === residentId)
    if (!match) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const resident = await db.query.residents.findFirst({
      where: eq(residents.id, match.residentId),
      columns: { facilityId: true },
    })
    if (!resident) return Response.json({ error: 'Not found' }, { status: 404 })

    const rows = await db.query.services.findMany({
      where: and(
        eq(services.facilityId, resident.facilityId),
        eq(services.active, true),
        eq(services.isDemo, false), // is_demo filter — Phase 13
        eq(services.source, 'price_list'),
        eq(services.pricingType, 'fixed'),
      ),
      columns: { id: true, name: true, priceCents: true },
      orderBy: (t, { asc }) => [asc(t.priceCents)],
      limit: 50,
    })

    return Response.json({ data: rows })
  } catch (err) {
    console.error('GET /api/portal/session/services error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
