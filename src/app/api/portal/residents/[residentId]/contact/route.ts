import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getPortalSession } from '@/lib/portal-auth'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// POA-editable contact fields. NOTE: poaEmail is intentionally NOT here — it is
// the portal login identity (auth = residents.poa_email); changing it would
// de-link the account on the next magic-link auto-discovery. Resident name +
// room are facility-managed and stay read-only in the portal.
const bodySchema = z.object({
  phone: z.string().max(50).nullable().optional(),
  poaName: z.string().max(200).nullable().optional(),
  poaPhone: z.string().max(50).nullable().optional(),
  poaAddress: z.string().max(500).nullable().optional(),
  poaCity: z.string().max(200).nullable().optional(),
})

const clean = (v: string | null | undefined): string | null => {
  if (v == null) return null
  const t = v.trim()
  return t.length ? t : null
}

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

    // Only write keys the caller actually sent (partial update).
    const updates: Record<string, string | null | Date> = { updatedAt: new Date() }
    const d = parsed.data
    if ('phone' in d) updates.phone = clean(d.phone)
    if ('poaName' in d) updates.poaName = clean(d.poaName)
    if ('poaPhone' in d) updates.poaPhone = clean(d.poaPhone)
    if ('poaAddress' in d) updates.poaAddress = clean(d.poaAddress)
    if ('poaCity' in d) updates.poaCity = clean(d.poaCity)

    await db.update(residents).set(updates).where(eq(residents.id, residentId))

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/portal/residents/[residentId]/contact error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
