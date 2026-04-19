import { db } from '@/db'
import { stylists, oauthStates } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { exchangeCodeForTokens } from '@/lib/google-calendar/oauth-client'

const STATE_TTL_MS = 10 * 60 * 1000

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  try {
    if (!code || !state) throw new Error('Missing code or state')

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.nextUrl.origin))
    }

    const nonce = Buffer.from(state, 'base64').toString()
    if (!nonce) throw new Error('Invalid state')

    const stateRow = await db.query.oauthStates.findFirst({
      where: eq(oauthStates.nonce, nonce),
    })
    if (!stateRow) throw new Error('Unknown or already-used state')
    if (stateRow.userId !== user.id) throw new Error('State does not belong to current user')
    if (stateRow.createdAt && Date.now() - stateRow.createdAt.getTime() > STATE_TTL_MS) {
      await db.delete(oauthStates).where(eq(oauthStates.nonce, nonce))
      throw new Error('State expired')
    }
    if (!stateRow.stylistId) throw new Error('State missing stylist id')

    const facilityUser = await getUserFacility(user.id)
    if (!facilityUser) throw new Error('No facility')

    const stylist = await db.query.stylists.findFirst({
      where: and(eq(stylists.id, stateRow.stylistId), eq(stylists.facilityId, facilityUser.facilityId)),
    })
    if (!stylist) throw new Error('Stylist not in facility')

    const { refreshToken, calendarId } = await exchangeCodeForTokens(code)

    await db
      .update(stylists)
      .set({ googleRefreshToken: refreshToken, googleCalendarId: calendarId, updatedAt: new Date() })
      .where(eq(stylists.id, stylist.id))

    await db.delete(oauthStates).where(eq(oauthStates.nonce, nonce))

    return NextResponse.redirect(new URL('/my-account?calendar=connected', request.nextUrl.origin))
  } catch (err) {
    console.error('Google Calendar OAuth callback error:', err)
    return NextResponse.redirect(new URL('/my-account?calendar=error', request.nextUrl.origin))
  }
}
