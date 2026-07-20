// P36 — portal coverage: which residents have a linked family-portal account,
// which have a POA email but no account (invitable), which have no POA email.
// ONE LEFT-JOIN query; powers the "Portal status" panel in Settings → Family
// Portal.

import { db } from '@/db'
import { getUserFacility } from '@/lib/get-facility-id'
import { createClient } from '@/lib/supabase/server'
import { sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    const isMaster = user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!facilityUser || (facilityUser.role !== 'admin' && !isMaster)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rows = (await db.execute(sql`
      SELECT r.id::text AS id, r.name, r.room_number, r.poa_email,
        r.last_portal_invite_sent_at,
        (par.resident_id IS NOT NULL) AS linked
      FROM residents r
      LEFT JOIN (SELECT DISTINCT resident_id FROM portal_account_residents) par
        ON par.resident_id = r.id
      WHERE r.facility_id = ${facilityUser.facilityId}
        AND r.active = true AND r.is_demo = false
      ORDER BY r.name
    `)) as unknown as Array<{
      id: string
      name: string
      room_number: string | null
      poa_email: string | null
      last_portal_invite_sent_at: string | Date | null
      linked: boolean
    }>

    let linked = 0
    let invitableCount = 0
    let noPoaEmail = 0
    const invitable: Array<{
      id: string
      name: string
      roomNumber: string | null
      poaEmail: string
      lastInvitedAt: string | null
    }> = []

    for (const r of rows) {
      if (r.linked) linked++
      else if (r.poa_email) {
        invitableCount++
        if (invitable.length < 100) {
          invitable.push({
            id: r.id,
            name: r.name,
            roomNumber: r.room_number,
            poaEmail: r.poa_email,
            lastInvitedAt: r.last_portal_invite_sent_at
              ? new Date(r.last_portal_invite_sent_at).toISOString()
              : null,
          })
        }
      } else noPoaEmail++
    }

    return Response.json({
      data: {
        counts: { total: rows.length, linked, invitable: invitableCount, noPoaEmail },
        invitable,
      },
    })
  } catch (err) {
    console.error('GET /api/portal/coverage error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
