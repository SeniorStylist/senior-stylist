import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  // Clone request.nextUrl (Next.js enriches this with the correct public host
  // via X-Forwarded-Host) and change only the pathname. Never build a redirect
  // URL from strings — process.env or new URL(request.url) can both resolve to
  // localhost:3000 on Vercel's internal Node runtime.
  const redirectUrl = request.nextUrl.clone()
  redirectUrl.pathname = '/dashboard'
  redirectUrl.search = ''
  return NextResponse.redirect(redirectUrl)
}
