import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { feedbackSubmissions } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { NextRequest } from 'next/server'

const patchSchema = z.object({
  status: z.enum(['new', 'reviewed', 'resolved']),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    const superAdminEmail = process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL
    if (!superAdminEmail || user.email !== superAdminEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 422 })

    const [updated] = await db
      .update(feedbackSubmissions)
      .set({ status: parsed.data.status })
      .where(eq(feedbackSubmissions.id, id))
      .returning({ id: feedbackSubmissions.id, status: feedbackSubmissions.status })
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 })

    return Response.json({ data: updated })
  } catch (err) {
    console.error('PATCH /api/feedback/[id] error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
