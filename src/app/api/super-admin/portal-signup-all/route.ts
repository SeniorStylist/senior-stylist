import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { facilities } from '@/db/schema'
import { and, eq } from 'drizzle-orm'
import { revalidateTag } from 'next/cache'

// P52 — one-click "family signup ON everywhere" for the master admin.
// This is the no-psql production path for drizzle/0035's backfill: flips
// portal_self_signup_enabled on every active facility that still has it off.
// The per-facility OFF toggle in Settings → Family Portal is unaffected
// (an admin can switch an individual facility back off afterwards).
export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const su = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!su || user.email !== su) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const flipped = await db
      .update(facilities)
      .set({ portalSelfSignupEnabled: true })
      .where(and(eq(facilities.active, true), eq(facilities.portalSelfSignupEnabled, false)))
      .returning({ id: facilities.id })

    revalidateTag('facilities', {})

    return Response.json({ data: { enabled: flipped.length } })
  } catch (err) {
    console.error('POST /api/super-admin/portal-signup-all error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
