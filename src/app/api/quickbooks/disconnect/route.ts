// Two modes:
//   detach  (default) — take THIS facility off the shared QuickBooks connection;
//                       the connection stays live for every other facility.
//   company           — master only: revoke the authorization at Intuit and
//                       detach every facility in that realm.

import { createClient } from '@/lib/supabase/server'
import { getUserFacility, canManageQuickBooksBilling } from '@/lib/get-facility-id'
import { detachFacility, disconnectRealm, getFacilityRealm } from '@/lib/qb-connection'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const schema = z.object({
  mode: z.enum(['detach', 'company']).default('detach'),
  facilityId: z.string().regex(UUID_RE).optional(),
  realmId: z.string().regex(/^\d{1,30}$/).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const raw = await request.text()
    const parsed = schema.safeParse(raw ? JSON.parse(raw) : {})
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })
    const { mode } = parsed.data

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL

    if (mode === 'company') {
      if (!isMaster) return Response.json({ error: 'Forbidden' }, { status: 403 })
      let realmId = parsed.data.realmId ?? null
      if (!realmId && parsed.data.facilityId) realmId = await getFacilityRealm(parsed.data.facilityId)
      if (!realmId) return Response.json({ error: 'realmId required' }, { status: 400 })
      const out = await disconnectRealm(realmId)
      revalidateTag('facilities', { expire: 0 })
      revalidateTag('billing', { expire: 0 })
      return Response.json({ data: { disconnected: true, detached: out.detached } })
    }

    // detach — the caller's facility (or, for master, any facility by id)
    let facilityId: string | null = null
    if (isMaster && parsed.data.facilityId) {
      facilityId = parsed.data.facilityId
    } else {
      const facilityUser = await getUserFacility(user.id)
      if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
      if (!canManageQuickBooksBilling(facilityUser.role) && !isMaster) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      facilityId = facilityUser.facilityId
    }
    await detachFacility(facilityId)
    revalidateTag('facilities', { expire: 0 })
    revalidateTag('billing', { expire: 0 })
    return Response.json({ data: { disconnected: true, detached: 1 } })
  } catch (err) {
    console.error('QuickBooks disconnect error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
