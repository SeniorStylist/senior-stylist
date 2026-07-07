// Phase 19 — server-synced mobile-nav customization. The picker on the phone
// saves per-role pinned tabs here so they follow the user across devices;
// localStorage stays the instant-apply layer (and the offline fallback).

import { db } from '@/db'
import { userPrefs } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { ensureUserPrefsSchema } from '@/lib/user-prefs-ddl'

const putSchema = z.object({
  role: z.string().min(1).max(30),
  hrefs: z.array(z.string().min(1).max(60)).max(8),
})

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    await ensureUserPrefsSchema()
    const row = await db.query.userPrefs.findFirst({
      where: eq(userPrefs.userId, user.id),
      columns: { mobileNav: true },
    })
    return Response.json({ data: { mobileNav: row?.mobileNav ?? null } })
  } catch (err) {
    console.error('GET /api/profile/nav-prefs error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = putSchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }
    const { role, hrefs } = parsed.data

    await ensureUserPrefsSchema()
    const existing = await db.query.userPrefs.findFirst({
      where: eq(userPrefs.userId, user.id),
      columns: { mobileNav: true },
    })
    const merged = { ...(existing?.mobileNav ?? {}), [role]: hrefs }
    await db
      .insert(userPrefs)
      .values({ userId: user.id, mobileNav: merged, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userPrefs.userId,
        set: { mobileNav: merged, updatedAt: new Date() },
      })
    return Response.json({ data: { mobileNav: merged } })
  } catch (err) {
    console.error('PUT /api/profile/nav-prefs error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
