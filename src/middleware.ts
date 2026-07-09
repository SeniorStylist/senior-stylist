import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Short-circuit: paths with their own auth (or no auth) skip Supabase entirely.
  // Saves a Supabase network round-trip per request on these high-traffic surfaces.
  // /family + /portal carry their own session cookies; /privacy + /terms are public;
  // /api/portal + /api/cron have route-level auth (bearer / token).
  // NOTE: /invoice is NOT here — it is an authenticated billing page (page-level guard),
  // so it must go through the normal Supabase session path, not the short-circuit.
  const skipSupabase =
    pathname.startsWith('/portal') ||
    pathname.startsWith('/family') ||
    pathname.startsWith('/api/portal') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/access-requests') || // public — no Supabase auth needed
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/terms')

  if (skipSupabase) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Phase 25 — auth fast path. getClaims() cryptographically VERIFIES the JWT:
  // locally against the project's JWKS when the project uses asymmetric signing
  // keys (zero network calls on the warm path), or via the Auth server for
  // legacy HS256 projects (identical cost + semantics to getUser — no
  // regression). It calls getSession() first, so expired-token refresh is
  // preserved. Unverified claims are NEVER trusted — a bad signature returns an
  // error and we fall back to a full getUser() server check. Access tokens are
  // short-lived, and every page/API route still runs its own
  // getUser()+getUserFacility() authorization, so middleware remains a redirect
  // convenience layer, not the security boundary.
  let user: { id: string; email: string | undefined } | null = null
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
  if (claimsData?.claims?.sub) {
    user = {
      id: claimsData.claims.sub,
      email: typeof claimsData.claims.email === 'string' ? claimsData.claims.email : undefined,
    }
  } else if (claimsError) {
    // Transient verification failure (e.g. JWKS fetch hiccup) — don't bounce a
    // valid session to /login; do the full server check instead.
    const {
      data: { user: fullUser },
    } = await supabase.auth.getUser()
    if (fullUser) user = { id: fullUser.id, email: fullUser.email ?? undefined }
  }

  // Public routes — no auth required (subset of skipSupabase that still needs
  // session refresh, e.g. /login redirects authenticated users to /dashboard)

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/unauthorized') ||
    pathname.startsWith('/invite/accept') ||
    pathname.startsWith('/portal') ||
    pathname.startsWith('/family') ||
    pathname.startsWith('/api/portal') ||
    pathname.startsWith('/api/auth/google-calendar/callback') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/terms')

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    const originalPath = pathname + request.nextUrl.search
    url.pathname = '/login'
    url.search = ''
    if (originalPath && originalPath !== '/') {
      url.searchParams.set('redirect', originalPath)
    }
    return NextResponse.redirect(url)
  }

  // If authenticated, check facility access (skip public routes)
  if (user && !isPublic) {
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isSuperAdmin = superAdminEmail && user.email === superAdminEmail

    // Phase 25 — membership cookie: a successful facility_users check is cached
    // for 5 minutes (ss_mw_ok, httpOnly, keyed to the user id) so repeat
    // requests skip the PostgREST round-trip. SECURITY: this cookie only skips
    // the "does this account belong anywhere?" REDIRECT below — it can never
    // bypass authentication (checked above) or authorization (every page/API
    // re-checks via getUserFacility). Worst case, a just-removed member gets a
    // route-level 403 instead of a middleware redirect for ≤5 minutes.
    const membershipCached = request.cookies.get('ss_mw_ok')?.value === user.id

    if (!isSuperAdmin && !membershipCached) {
      // Check if user has a facilityUser record
      const { data: facilityUser } = await supabase
        .from('facility_users')
        .select('facility_id')
        .eq('user_id', user.id)
        .limit(1)
        .single()

      if (facilityUser) {
        supabaseResponse.cookies.set('ss_mw_ok', user.id, {
          httpOnly: true,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: 300,
        })
      }

      if (!facilityUser) {
        // Check if user has a pending valid invite
        const { data: inviteRows } = await supabase
          .from('invites')
          .select('id, token')
          .eq('email', user.email ?? '')
          .eq('used', false)
          .gt('expires_at', new Date().toISOString())
          .limit(1)

        const inviteToken = inviteRows && inviteRows.length > 0 ? (inviteRows[0] as { token: string }).token : null

        // Allow /onboarding and /invite paths through regardless
        if (pathname.startsWith('/onboarding') || pathname.startsWith('/invite') || pathname.startsWith('/api/invite/redeem')) {
          // allow through
        } else if (inviteToken) {
          // Has a valid invite — send them to complete it
          const url = request.nextUrl.clone()
          url.pathname = '/invite/accept'
          url.searchParams.set('token', inviteToken)
          return NextResponse.redirect(url)
        } else {
          // No invite, no facilityUser
          const url = request.nextUrl.clone()
          url.pathname = '/unauthorized'
          return NextResponse.redirect(url)
        }
      }
    }
  }

  const isSensitivePage =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/payroll') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/residents') ||
    pathname.startsWith('/stylists') ||
    pathname.startsWith('/analytics') ||
    pathname.startsWith('/reports') ||
    pathname.startsWith('/log') ||
    pathname.startsWith('/directory') ||
    pathname.startsWith('/invoice') ||
    pathname.startsWith('/billing')

  if (user && isSensitivePage) {
    supabaseResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
    supabaseResponse.headers.set('Pragma', 'no-cache')
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - PWA plumbing: sw.js / manifest.json / offline.html MUST bypass auth —
     *   the middleware 307'd them to /login for unauthenticated visitors
     *   (family portal, logged-out staff), which broke service-worker
     *   registration, PWA install, and the offline fallback (Phase 17 fix)
     * - public folder images
     */
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|offline\\.html|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
