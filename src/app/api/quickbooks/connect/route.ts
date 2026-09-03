// Start the Intuit OAuth flow. `scope` decides which facilities get attached
// to the QuickBooks company once the callback lands:
//   facility  (default) — the caller's active facility (manage tier)
//   franchise           — every facility in the caller's franchise (franchise admin / master)
//   all                 — every active facility (master only)
// The scope rides inside the signed-by-nonce `state` and is RE-VALIDATED
// against the caller's role in the callback (never trusted from the URL).

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { oauthStates } from '@/db/schema'
import { getUserFacility, canManageQuickBooksBilling, isFranchiseAdmin } from '@/lib/get-facility-id'
import { getQBAuthUrl, qbRedirectUri } from '@/lib/quickbooks'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const isMaster =
      !!process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL && user.email === process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const requestedScope = request.nextUrl.searchParams.get('scope') ?? 'facility'
    const scope: 'facility' | 'franchise' | 'all' =
      requestedScope === 'all' ? 'all' : requestedScope === 'franchise' ? 'franchise' : 'facility'
    // Where to land afterwards: settings (facility), franchise dashboard, or master QB page.
    const requestedReturn = request.nextUrl.searchParams.get('return') ?? ''
    const returnTo =
      requestedReturn === 'master' ? 'master' : requestedReturn === 'franchise' ? 'franchise' : 'settings'

    const facilityUser = await getUserFacility(user.id)
    let facilityId: string | null = facilityUser?.facilityId ?? null

    // Master may anchor on any facility (the master QB page passes one) or none.
    const requested = request.nextUrl.searchParams.get('facilityId')
    if (isMaster && requested && UUID_RE.test(requested)) facilityId = requested

    if (scope === 'all') {
      if (!isMaster) return Response.json({ error: 'Forbidden' }, { status: 403 })
    } else if (scope === 'franchise') {
      if (!isMaster && !(await isFranchiseAdmin(user.id))) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (!facilityId) return Response.json({ error: 'No facility' }, { status: 400 })
    } else {
      if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
      if (!canManageQuickBooksBilling(facilityUser.role) && !isMaster) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const nonce = randomUUID()
    await db.insert(oauthStates).values({
      nonce,
      userId: user.id,
      facilityId,
    })

    // Canonical URI (qbRedirectUri) — never the request origin; Intuit
    // rejects any host not registered verbatim in the app's Redirect URIs.
    const state = Buffer.from(JSON.stringify({ n: nonce, s: scope, r: returnTo })).toString('base64url')
    return NextResponse.redirect(getQBAuthUrl(state, qbRedirectUri()))
  } catch (err) {
    console.error('QuickBooks connect error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
