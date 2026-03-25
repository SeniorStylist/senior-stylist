import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
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

  // Refresh session
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public routes — no auth required
  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/unauthorized') ||
    pathname.startsWith('/invite/accept') ||
    pathname.startsWith('/portal') ||
    pathname.startsWith('/api/portal') ||
    pathname.startsWith('/invoice')

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // If authenticated, check facility access (skip public routes)
  if (user && !isPublic) {
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    const isSuperAdmin = superAdminEmail && user.email === superAdminEmail

    if (!isSuperAdmin) {
      // Check if user has a facilityUser record
      const { data: facilityUser } = await supabase
        .from('facility_users')
        .select('facility_id')
        .eq('user_id', user.id)
        .limit(1)
        .single()

      if (!facilityUser) {
        // Check if user has a pending valid invite
        let hasInvite = false
        const { data: invite } = await supabase
          .from('invites')
          .select('id')
          .eq('email', user.email ?? '')
          .eq('used', false)
          .gt('expires_at', new Date().toISOString())
          .limit(1)

        if (invite && invite.length > 0) {
          hasInvite = true
        }

        // Allow /onboarding — invited users land here before creating a facility
        if (!hasInvite && !pathname.startsWith('/onboarding')) {
          const url = request.nextUrl.clone()
          url.pathname = '/unauthorized'
          return NextResponse.redirect(url)
        }
      }
    }
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
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
