import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'

/**
 * Phase 25 — request-deduped auth lookup for SERVER COMPONENTS. getUser() is a
 * network round-trip to the Supabase Auth server; the protected layout and the
 * page it wraps render in the same RSC pass, so without dedupe every navigation
 * pays that round-trip twice (plus once more per nested fetch helper).
 * React.cache() shares one call per request across the whole render tree.
 * Outside a React render (route handlers) cache() degrades to a plain call —
 * safe, but route handlers should keep using createClient().auth.getUser()
 * directly since they get no dedupe benefit.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}
