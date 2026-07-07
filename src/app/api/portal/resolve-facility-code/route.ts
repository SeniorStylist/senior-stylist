// Phase 15 F5 — resolve a facility code typed by a family member on the /family
// entry page. Public (under /api/portal = middleware-allowlisted), rate-limited,
// explicit columns only — never leaks anything beyond the facility's display name.

import { db } from '@/db'
import { facilities } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

const schema = z.object({ code: z.string().min(1).max(20) })

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const rl = await checkRateLimit('portalTokenLookup', `ip:${ip}`)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Enter a facility code' }, { status: 422 })
    const code = parsed.data.code.trim().toUpperCase()

    const facility = await db.query.facilities.findFirst({
      where: and(
        sql`UPPER(${facilities.facilityCode}) = ${code}`,
        eq(facilities.active, true),
        eq(facilities.isDemo, false),
      ),
      columns: { facilityCode: true, name: true },
    })
    if (!facility?.facilityCode) {
      return Response.json({ error: 'No facility found for that code' }, { status: 404 })
    }

    return Response.json({ data: { facilityCode: facility.facilityCode, facilityName: facility.name } })
  } catch (err) {
    console.error('POST /api/portal/resolve-facility-code error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
