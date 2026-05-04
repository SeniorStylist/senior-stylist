import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getPortalSession } from '@/lib/portal-auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  defaultTipType: z.enum(['percentage', 'fixed']).nullable(),
  defaultTipValue: z.number().int().min(0).max(10_000_000).nullable(),
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ residentId: string }> },
) {
  try {
    const { residentId } = await params

    const session = await getPortalSession()
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    // Cross-resident leak guard: the residentId must be one of the POA's linked residents.
    const owned = session.residents.some((r) => r.residentId === residentId)
    if (!owned) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const rl = await checkRateLimit('portalProfileUpdate', session.portalAccountId)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const body = await request.json().catch(() => ({}))
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    // Coherence: when type is null, value must be null. When type is set, value must be present.
    const { defaultTipType, defaultTipValue } = parsed.data
    if (defaultTipType === null && defaultTipValue !== null) {
      return Response.json({ error: 'defaultTipValue must be null when type is null' }, { status: 422 })
    }
    if (defaultTipType !== null && defaultTipValue === null) {
      return Response.json({ error: 'defaultTipValue is required when type is set' }, { status: 422 })
    }

    await db
      .update(residents)
      .set({ defaultTipType, defaultTipValue, updatedAt: new Date() })
      .where(eq(residents.id, residentId))

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/portal/residents/[residentId]/tip-default error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
