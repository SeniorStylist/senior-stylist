import { NextRequest } from 'next/server'
import { db } from '@/db'
import { residents } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { matchResidentForSignup } from '@/lib/signup-match'
import { activeFacilityByCodeWhere } from '@/lib/facility-code'
import { maskName } from '@/lib/name-mask'
import { isMasterSession } from '@/lib/master-session'

export const dynamic = 'force-dynamic'

// P52 — public "is this them?" preview for the signup wizard. CONTRACT:
// - decides NOTHING the signup POST trusts — the POST re-derives the exact
//   same match via matchResidentForSignup from the typed values;
// - returns CONFIDENT matches only, and NEVER resident ids or candidate lists
//   (an attacker with a door-visible name+room learns only the on-file
//   spelling, room, and POA initials — owner-accepted, gift-flow precedent);
// - the wizard must never block on this call (client uses a 3s timeout).
const matchSchema = z.object({
  facilityCode: z.string().min(1).max(50),
  residentName: z.string().min(2).max(200),
  roomNumber: z.string().max(50).optional().nullable(),
})

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = await checkRateLimit('portalSignupMatch', `ip:${ip}`)
  if (!rl.ok) return rateLimitResponse(rl.retryAfter)

  const body = await request.json().catch(() => null)
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  const parsed = matchSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 422 })

  try {
    let facility = await db.query.facilities.findFirst({
      where: activeFacilityByCodeWhere(parsed.data.facilityCode), // P53 — case-insensitive + demo-excluded
      columns: { id: true, portalSelfSignupEnabled: true },
    })
  // APLEY — master-only fallback so a demo facility's portal resolves (see the family layout).
    if (!facility && (await isMasterSession())) {
      facility = await db.query.facilities.findFirst({
        where: activeFacilityByCodeWhere(parsed.data.facilityCode, { allowDemo: true }),
        columns: { id: true, portalSelfSignupEnabled: true },
      })
    }
    if (!facility) return Response.json({ error: 'Facility not found' }, { status: 404 })
    if (!facility.portalSelfSignupEnabled) {
      return Response.json({ error: 'Self-signup is not available for this facility.' }, { status: 403 })
    }

    const roster = await db.query.residents.findMany({
      where: and(
        eq(residents.facilityId, facility.id),
        eq(residents.active, true),
        eq(residents.isDemo, false),
      ),
      columns: { id: true, name: true, roomNumber: true, poaName: true },
    })

    const m = matchResidentForSignup(roster, parsed.data.residentName, parsed.data.roomNumber)
    if (!m?.confident) return Response.json({ data: { match: null } })

    return Response.json({
      data: {
        match: {
          residentName: m.resident.name,
          roomNumber: m.resident.roomNumber,
          poaMasked: m.resident.poaName ? maskName(m.resident.poaName) : null,
          hasPoa: !!m.resident.poaName,
        },
      },
    })
  } catch (err) {
    console.error('POST /api/portal/signup/match error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
