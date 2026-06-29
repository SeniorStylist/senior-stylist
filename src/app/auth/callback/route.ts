import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')

  // Read the ?next= param to redirect to the original destination
  const next = searchParams.get('next')

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)

    // Self-heal: if the user authenticated but has no facility membership for THIS
    // auth identity (e.g. they accepted the invite under a different sign-in method,
    // or the original membership insert failed), provision it from their invite.
    // Skipped for the invite-accept flow — redeem handles that explicitly.
    if (!next || !next.startsWith('/invite/accept')) {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { healMembershipOnLogin } = await import('@/lib/onboarding')
          const facilityId = await healMembershipOnLogin(user)
          if (facilityId) {
            const cookieStore = await cookies()
            if (!cookieStore.get('selected_facility_id')) {
              cookieStore.set('selected_facility_id', facilityId, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 60 * 60 * 24 * 365,
              })
            }
          }
        }
      } catch (err) {
        console.error('[auth/callback] heal-on-login failed:', err)
      }
    }
  }

  // Clone request.nextUrl (Next.js enriches this with the correct public host
  // via X-Forwarded-Host) and change only the pathname. Never build a redirect
  // URL from strings — process.env or new URL(request.url) can both resolve to
  // localhost:3000 on Vercel's internal Node runtime.
  const redirectUrl = request.nextUrl.clone()

  if (next && next.startsWith('/')) {
    // Parse the relative path which may include query params
    const qIdx = next.indexOf('?')
    redirectUrl.pathname = qIdx >= 0 ? next.slice(0, qIdx) : next
    redirectUrl.search = qIdx >= 0 ? next.slice(qIdx) : ''
  } else {
    redirectUrl.pathname = '/dashboard'
    redirectUrl.search = ''
  }

  return NextResponse.redirect(redirectUrl)
}
