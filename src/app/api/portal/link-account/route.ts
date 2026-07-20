// P36 — direct "link a portal account to a resident" tool. If an account with
// the given email already exists → insert the link immediately; otherwise send
// a magic-link invite to that email (which auto-creates + links on first use).

import { db } from '@/db'
import { facilities, residents, portalAccounts, portalAccountResidents } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { createClient } from '@/lib/supabase/server'
import { createMagicLink } from '@/lib/portal-auth'
import { buildPortalMagicLinkEmailHtml, sendEmail } from '@/lib/email'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { and, eq, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const schema = z.object({
  residentId: z.string().uuid(),
  email: z.string().email().max(320),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    const isMaster = user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!facilityUser || (facilityUser.role !== 'admin' && !isMaster)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rl = await checkRateLimit('sendPortalLink', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'A resident and a valid email are required.' }, { status: 422 })
    const email = parsed.data.email.trim().toLowerCase()

    const resident = await db.query.residents.findFirst({
      where: and(
        eq(residents.id, parsed.data.residentId),
        eq(residents.facilityId, facilityUser.facilityId),
        eq(residents.active, true),
      ),
    })
    if (!resident) return Response.json({ error: 'Resident not found' }, { status: 404 })

    const account = await db.query.portalAccounts.findFirst({
      where: eq(portalAccounts.email, email),
      columns: { id: true },
    })

    if (account) {
      await db
        .insert(portalAccountResidents)
        .values({ portalAccountId: account.id, residentId: resident.id, facilityId: resident.facilityId })
        .onConflictDoNothing()
      return Response.json({ data: { linked: true } })
    }

    // No account yet — send an invite (magic link auto-creates + links).
    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, resident.facilityId),
      columns: { name: true, facilityCode: true },
    })
    if (!facility?.facilityCode) {
      return Response.json({ error: 'Facility has no facility code — set one first.' }, { status: 400 })
    }
    const link = await createMagicLink(email, resident.id, facility.facilityCode, 72)
    const ok = await sendEmail({
      to: email,
      subject: `Your family portal access for ${resident.name} at ${facility.name}`,
      html: buildPortalMagicLinkEmailHtml({
        residentNames: [resident.name],
        facilityName: facility.name,
        link,
        expiresInHours: 72,
      }),
    })
    if (!ok) {
      return Response.json(
        { error: "The invite email couldn't be delivered — use Copy Link on the resident page instead." },
        { status: 502 },
      )
    }
    await db.execute(sql`UPDATE residents SET last_portal_invite_sent_at = NOW() WHERE id = ${resident.id}`)
    return Response.json({ data: { invited: true } })
  } catch (err) {
    console.error('POST /api/portal/link-account error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
