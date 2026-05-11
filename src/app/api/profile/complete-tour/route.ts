import { createClient } from '@/lib/supabase/server'
import { db } from '@/db'
import { sql } from 'drizzle-orm'
import { TOUR_DEFINITIONS } from '@/lib/help/tours'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { z } from 'zod'

const bodySchema = z.object({ tourId: z.string().min(1).max(100) })

export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const rl = await checkRateLimit('completeTour', user.id)
    if (!rl.ok) return rateLimitResponse(rl.retryAfter)

    const body = bodySchema.safeParse(await req.json())
    if (!body.success) return Response.json({ error: 'Invalid request' }, { status: 400 })
    const { tourId } = body.data

    if (!TOUR_DEFINITIONS[tourId]) {
      return Response.json({ error: 'Unknown tour' }, { status: 400 })
    }

    // Idempotent array_append — no-op if tourId already present
    await db.execute(
      sql`UPDATE profiles
          SET completed_tours = array_append(completed_tours, ${tourId}),
              updated_at = now()
          WHERE id = ${user.id}
          AND NOT (${tourId} = ANY(completed_tours))`,
    )

    return Response.json({ data: { ok: true } })
  } catch (err) {
    console.error('POST /api/profile/complete-tour error:', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
