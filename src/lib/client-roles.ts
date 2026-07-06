// Client-safe role predicates. Mirrors canAccessBilling in get-facility-id.ts —
// that module is server-only (Supabase server client / next/headers), so client
// components import from here instead. Keep in sync with get-facility-id.ts.

export function canSeeBilling(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'super_admin' || role === 'bookkeeper'
}
