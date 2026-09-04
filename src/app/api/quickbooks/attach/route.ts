// Attach facilities to an EXISTING QuickBooks connection without going through
// Intuit again. Master: any facilities / all / a franchise. Franchise admin:
// the facilities of their own franchise (anchored on their active facility).

import { createClient } from '@/lib/supabase/server'
import { getUserFacility, isFranchiseAdmin } from '@/lib/get-facility-id'
import { attachFacilities, facilityIdsForScope, getConnectionInfo } from '@/lib/qb-connection'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { NextRequest } from 'next/server'
import { revalidateTag } from 'next/cache'
import { z } from 'zod'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const schema = z.object({
  realmId: z.string().regex(/^\d{1,30}$/),
  scope: z.enum(['all', 'franchise', 'list']),
  facilityIds: z.array(z.string().regex(UUID_RE)).max(500).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = schema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })
    const { realmId, scope } = parsed.data

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const franchiseAdmin = isMaster ? false : await isFranchiseAdmin(user.id)
    if (!isMaster && !franchiseAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const rl = await checkRateLimit('quickbooksSync', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const conn = await getConnectionInfo(realmId)
    if (!conn?.connected) return Response.json({ error: 'That QuickBooks connection is not active' }, { status: 412 })

    let targetIds: string[]
    if (scope === 'all') {
      if (!isMaster) return Response.json({ error: 'Forbidden' }, { status: 403 })
      targetIds = await facilityIdsForScope('all', null)
    } else if (scope === 'franchise') {
      const fu = await getUserFacility(user.id)
      if (!fu) return Response.json({ error: 'No facility' }, { status: 400 })
      targetIds = await facilityIdsForScope('franchise', fu.facilityId)
    } else {
      if (!isMaster) return Response.json({ error: 'Forbidden' }, { status: 403 })
      targetIds = parsed.data.facilityIds ?? []
    }

    const result = await attachFacilities(realmId, targetIds)
    revalidateTag('facilities', { expire: 0 })
    revalidateTag('billing', { expire: 0 })
    return Response.json({
      data: {
        attached: result.attached.length,
        alreadyAttached: result.alreadyAttached.length,
        skipped: result.skipped.length,
      },
    })
  } catch (err) {
    console.error('QuickBooks attach error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
