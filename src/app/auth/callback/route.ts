import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  // Use NEXT_PUBLIC_APP_URL when set (production), otherwise fall back to
  // request.nextUrl.origin. Never use new URL(request.url).origin — on Vercel
  // the raw request.url host is the internal Node server (localhost:3000).
  const base = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin
  return NextResponse.redirect(`${base}/dashboard`)
}
