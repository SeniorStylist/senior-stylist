import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { oauthStates } from '@/db/schema'
import { getUserFacility, canAccessPayroll } from '@/lib/get-facility-id'
import { getQBAuthUrl } from '@/lib/quickbooks'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) return Response.json({ error: 'No facility' }, { status: 400 })
    if (!canAccessPayroll(facilityUser.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const nonce = randomUUID()
    await db.insert(oauthStates).values({
      nonce,
      userId: user.id,
      facilityId: facilityUser.facilityId,
    })

    const redirectUri = `${request.nextUrl.origin}/api/quickbooks/callback`
    const state = Buffer.from(nonce).toString('base64')
    return NextResponse.redirect(getQBAuthUrl(state, redirectUri))
  } catch (err) {
    console.error('QuickBooks connect error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
