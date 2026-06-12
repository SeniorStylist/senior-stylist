import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { profiles } from '@/db/schema'
import { ensureFeedbackSchema } from '@/lib/feedback-ddl'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

function isMasterAdmin(userEmail: string | undefined): boolean {
  const master = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
  return !!master && userEmail === master
}

export async function GET() {
  try {
    await ensureFeedbackSchema()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isMasterAdmin(user.email)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.id, user.id),
      columns: { feedbackEmail: true },
    })

    return Response.json({ data: { feedbackEmail: profile?.feedbackEmail ?? null } })
  } catch (err) {
    console.error('GET /api/feedback/settings error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const patchSchema = z.object({
  feedbackEmail: z.string().email().max(320).nullable(),
})

export async function PATCH(request: NextRequest) {
  try {
    await ensureFeedbackSchema()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!isMasterAdmin(user.email)) return Response.json({ error: 'Forbidden' }, { status: 403 })

    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid email' }, { status: 422 })

    await db.update(profiles)
      .set({ feedbackEmail: parsed.data.feedbackEmail })
      .where(eq(profiles.id, user.id))

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('PATCH /api/feedback/settings error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
