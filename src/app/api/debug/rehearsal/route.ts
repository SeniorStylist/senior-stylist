// P57-C5 — the launcher behind the Debug tab's "Launch rehearsal" card.
// Lisa asked for a click-through of every scenario before the Fitzgerald
// launch (docs/fitzgerald-walkthrough.md); this seeds the practice pieces the
// walkthrough needs at ANY facility the master picks — the existing
// /api/help/seed-demo-data is scoped to the caller's own selected facility, so
// it can't prepare a facility from the Master Admin screen.
//
// Master-email gated. Seeds only is_demo rows (the seeder is idempotent), so
// real residents, stylists, services and bookings are never touched, and the
// weekly help-demo-cleanup cron reaps what this creates.

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { createClient } from '@/lib/supabase/server'
import { seedFacilityDemoData } from '@/lib/help/demo-seeder'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

const bodySchema = z.object({ facilityId: z.string().uuid() })

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!superAdminEmail || user.email !== superAdminEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('helpSeed', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return Response.json({ error: 'facilityId is required' }, { status: 422 })

    const facility = await db.query.facilities.findFirst({
      where: and(eq(facilities.id, parsed.data.facilityId), eq(facilities.active, true)),
      columns: { id: true, name: true, facilityCode: true, portalSelfSignupEnabled: true },
    })
    if (!facility) return Response.json({ error: 'Facility not found' }, { status: 404 })
    if (!facility.facilityCode) {
      return Response.json(
        { error: 'This facility has no facility code — set one in Settings → General first' },
        { status: 422 },
      )
    }

    // Demo resident (Mrs. Smith), demo stylist with Mon–Fri availability, a
    // price_list service set, today's booking, a demo invoice/payment and a
    // demo pay period — everything the walkthrough's scenarios read.
    await seedFacilityDemoData(facility.id)

    return Response.json({
      data: {
        facilityId: facility.id,
        facilityName: facility.name,
        facilityCode: facility.facilityCode,
        selfSignupEnabled: facility.portalSelfSignupEnabled,
      },
    })
  } catch (err) {
    console.error('POST /api/debug/rehearsal error:', err)
    return Response.json({ error: 'Could not prepare the rehearsal' }, { status: 500 })
  }
}
