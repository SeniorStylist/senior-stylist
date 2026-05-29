import { createClient } from '@/lib/supabase/server'
import { getUserFacility } from '@/lib/get-facility-id'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { db } from '@/db'
import { helpStepEvents } from '@/db/schema'
import { z } from 'zod'

const bodySchema = z.object({
  tourId: z.string().min(1).max(200),
  stepIndex: z.number().int().min(0).max(100),
  action: z.enum(['shown', 'completed', 'abandoned', 'skipped']),
})

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await checkRateLimit('helpTrack', user.id)
  if (!rl.ok) return rateLimitResponse(rl.retryAfter)

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) return Response.json({ error: 'Invalid body' }, { status: 400 })

  let facilityId: string | null = null
  try {
    const fu = await getUserFacility(user.id)
    if (fu) facilityId = fu.facilityId
  } catch { /* non-blocking */ }

  await db.insert(helpStepEvents).values({
    facilityId,
    userId: user.id,
    tourId: parsed.data.tourId,
    stepIndex: parsed.data.stepIndex,
    action: parsed.data.action,
  })

  return Response.json({ data: { ok: true } })
}
