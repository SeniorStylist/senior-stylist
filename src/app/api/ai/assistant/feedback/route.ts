// P46 — answer thumbs. A 👍/👎 on an assistant reply lands in the EXISTING
// owner feedback queue (feedback_submissions) so Josh sees exactly which
// answers work and which don't — feeding the P44 learnings flywheel with
// zero new review surfaces.

import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { feedbackSubmissions } from '@/db/schema'
import { getUserFacility } from '@/lib/get-facility-id'
import { ensureFeedbackSchema } from '@/lib/feedback-ddl'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { z } from 'zod'
import { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  rating: z.enum(['up', 'down']),
  answer: z.string().min(1).max(600),
  question: z.string().max(600).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'Invalid input' }, { status: 422 })
    const { rating, answer, question } = parsed.data

    const rl = await checkRateLimit('feedback', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    await ensureFeedbackSchema()
    const facilityUser = await getUserFacility(user.id)
    await db.insert(feedbackSubmissions).values({
      userId: user.id,
      facilityId: facilityUser?.facilityId ?? null,
      role: facilityUser?.role ?? null,
      category: 'other',
      message: `Assistant answer ${rating === 'up' ? '👍' : '👎'}: “${answer.slice(0, 400)}”${question ? ` — asked: “${question.slice(0, 150)}”` : ''}`,
      pagePath: '/assistant',
      meta: { source: 'assistant-thumbs' } as never,
      status: rating === 'up' ? 'reviewed' : 'new', // only 👎 needs owner attention
    })
    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/ai/assistant/feedback error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
