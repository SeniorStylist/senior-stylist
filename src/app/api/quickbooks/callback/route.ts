import { db } from '@/db'
import { facilities, oauthStates } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeQBCode } from '@/lib/quickbooks'
import { encryptToken } from '@/lib/token-crypto'

const STATE_TTL_MS = 10 * 60 * 1000

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const realmId = searchParams.get('realmId')

  try {
    if (!code || !state || !realmId) throw new Error('Missing code, state, or realmId')

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.redirect(new URL('/login', origin))

    const nonce = Buffer.from(state, 'base64').toString()
    if (!nonce) throw new Error('Invalid state')

    const stateRow = await db.query.oauthStates.findFirst({
      where: eq(oauthStates.nonce, nonce),
    })
    if (!stateRow) throw new Error('Unknown or already-used state')
    if (stateRow.userId !== user.id) throw new Error('State user mismatch')
    if (!stateRow.facilityId) throw new Error('State missing facility id')
    if (stateRow.createdAt && Date.now() - stateRow.createdAt.getTime() > STATE_TTL_MS) {
      await db.delete(oauthStates).where(eq(oauthStates.nonce, nonce))
      throw new Error('State expired')
    }

    const tokens = await exchangeQBCode(
      code,
      `${origin}/api/quickbooks/callback`,
    )

    await db
      .update(facilities)
      .set({
        qbRealmId: realmId,
        qbAccessToken: encryptToken(tokens.accessToken),
        qbRefreshToken: encryptToken(tokens.refreshToken),
        qbTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        updatedAt: new Date(),
      })
      .where(eq(facilities.id, stateRow.facilityId))

    await db.delete(oauthStates).where(eq(oauthStates.nonce, nonce))

    return NextResponse.redirect(new URL('/settings?section=billing&qb=connected', origin))
  } catch (err) {
    console.error('QuickBooks callback error:', err)
    const reason = encodeURIComponent((err as Error).message?.slice(0, 80) ?? 'unknown')
    return NextResponse.redirect(
      new URL(`/settings?section=billing&qb=error&reason=${reason}`, origin),
    )
  }
}
