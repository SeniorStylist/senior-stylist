// APLEY — "is the current request the master admin?", as a server-only helper.
//
// The check itself is one line and already appears inline in dozens of routes,
// but the family portal needs it in a place `@/lib/facility-code` cannot
// provide: that module is imported by a client component
// (new-facility-wizard/facility-code-field.tsx), so it must stay free of
// `next/headers` and Supabase server imports.
//
// Used ONLY to decide whether a demo facility's family portal may resolve for
// this viewer. It is never used to grant a write, and it is never derived from
// anything the client supplies — `getAuthUser()` reads the verified Supabase
// session cookie, and the email is compared against the env var.

import { getAuthUser } from '@/lib/supabase/server'

/**
 * True when the signed-in Supabase user is the master admin.
 *
 * `getAuthUser` is React.cache-wrapped, so within one server render this costs
 * at most one round-trip no matter how many callers ask. Callers on the family
 * portal deliberately consult this only AFTER a normal (demo-excluded) lookup
 * has missed, so an ordinary family visit pays nothing for it.
 */
export async function isMasterSession(): Promise<boolean> {
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail) return false
  try {
    const user = await getAuthUser()
    return !!user?.email && user.email === superAdminEmail
  } catch {
    // An auth hiccup must never turn into "yes" — and on the family portal it
    // must not turn into a crash either: the caller falls back to the ordinary
    // demo-excluded lookup, which is the correct public behaviour.
    return false
  }
}
