import { db } from '@/db'
import { stylists } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/google-calendar/oauth-client'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')

  try {
    if (!code || !state) throw new Error('Missing code or state')

    const stylistId = Buffer.from(state, 'base64').toString()
    if (!stylistId) throw new Error('Invalid state param')

    const { refreshToken, calendarId } = await exchangeCodeForTokens(code)

    await db
      .update(stylists)
      .set({ googleRefreshToken: refreshToken, googleCalendarId: calendarId, updatedAt: new Date() })
      .where(eq(stylists.id, stylistId))

    return NextResponse.redirect(new URL('/my-account?calendar=connected', request.nextUrl.origin))
  } catch (err) {
    console.error('Google Calendar OAuth callback error:', err)
    return NextResponse.redirect(new URL('/my-account?calendar=error', request.nextUrl.origin))
  }
}
