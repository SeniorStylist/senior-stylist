// P36 — bulk portal invites: every active resident at the facility with a POA
// email, no linked portal account, and no invite in the last 7 days gets a
// magic-link email. Processes at most 25 per run (each send is AWAITED per the
// project's user-initiated-email rule; 25 stays well inside maxDuration 60) —
// the response reports `remaining` so the client can offer "Run again".

import { db } from '@/db'
import { facilities } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { createClient } from '@/lib/supabase/server'
import { createMagicLink } from '@/lib/portal-auth'
import { buildPortalMagicLinkEmailHtml, sendEmail } from '@/lib/email'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { eq, sql } from 'drizzle-orm'
import { NextRequest } from 'next/server'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const BATCH = 25

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

    const rl = await checkRateLimit('portalBulkInvite', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const facilityId = facilityUser.facilityId
    const facility = await db.query.facilities.findFirst({
      where: eq(facilities.id, facilityId),
      columns: { id: true, name: true, facilityCode: true },
    })
    if (!facility?.facilityCode) {
      return Response.json(
        { error: 'Facility has no facility code — set one before sending portal invites' },
        { status: 400 },
      )
    }

    // ONE eligibility query (max:1 rule — no per-resident lookups).
    const eligible = (await db.execute(sql`
      SELECT r.id::text AS id, r.name, r.poa_email
      FROM residents r
      LEFT JOIN portal_account_residents par ON par.resident_id = r.id
      WHERE r.facility_id = ${facilityId}
        AND r.active = true AND r.is_demo = false
        AND r.poa_email IS NOT NULL AND r.poa_email <> ''
        AND par.resident_id IS NULL
        AND (r.last_portal_invite_sent_at IS NULL OR r.last_portal_invite_sent_at < NOW() - interval '7 days')
      ORDER BY r.name
    `)) as unknown as Array<{ id: string; name: string; poa_email: string }>

    const batch = eligible.slice(0, BATCH)
    const sentIds: string[] = []
    let failed = 0

    for (const r of batch) {
      try {
        const link = await createMagicLink(r.poa_email, r.id, facility.facilityCode, 72)
        const ok = await sendEmail({
          to: r.poa_email,
          subject: `Your family portal access for ${r.name} at ${facility.name}`,
          html: buildPortalMagicLinkEmailHtml({
            residentNames: [r.name],
            facilityName: facility.name,
            link,
            expiresInHours: 72,
          }),
        })
        if (ok) sentIds.push(r.id)
        else failed++
      } catch {
        failed++
      }
    }

    // ONE batched cooldown update — never per-row.
    if (sentIds.length > 0) {
      await db.execute(sql`
        UPDATE residents SET last_portal_invite_sent_at = NOW()
        WHERE id = ANY(${sentIds}::uuid[])
      `)
    }

    return Response.json({
      data: {
        sent: sentIds.length,
        failed,
        remaining: Math.max(0, eligible.length - batch.length),
      },
    })
  } catch (err) {
    console.error('POST /api/portal/bulk-invite error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
