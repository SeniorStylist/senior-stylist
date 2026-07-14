import { cookies } from 'next/headers'
import { db } from '@/db'
import { profiles } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// P30 — THE way server code resolves "which stylist is this caller?".
//
// Normally that's profiles.stylistId. Under master-admin debug impersonation
// the master's own profile has no stylistId, so every ownership check
// (Done/No-show, finalize, walk-in) failed and testing-as-a-stylist was a lie.
// The __debug_role cookie now carries the impersonated stylistId; this helper
// honors it ONLY after re-verifying the caller really is the master admin
// (the cookie is httpOnly:false and attacker-writable — same gate as
// getUserFacility's debug branch).

async function isMasterAdmin(userId: string): Promise<boolean> {
  const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  if (!superAdminEmail) return false
  try {
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) return false
    return data.user.email === superAdminEmail
  } catch {
    return false
  }
}

/**
 * The stylist identity of the current caller: the debug-impersonated stylist
 * (master-verified) when active, else the caller's own profiles.stylistId.
 * Null = this account is not linked to any stylist.
 */
export async function getEffectiveStylistId(userId: string): Promise<string | null> {
  try {
    const cookieStore = await cookies()
    const debugRaw = cookieStore.get('__debug_role')?.value
    if (debugRaw) {
      try {
        const debug = JSON.parse(debugRaw) as { role?: string; stylistId?: string | null }
        if (debug.role === 'stylist' && (await isMasterAdmin(userId))) {
          return debug.stylistId ?? null
        }
      } catch { /* malformed cookie — fall through */ }
    }
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, userId),
      columns: { stylistId: true },
    })
    return profile?.stylistId ?? null
  } catch (err) {
    console.error('[effective-stylist] lookup failed:', err)
    return null
  }
}
